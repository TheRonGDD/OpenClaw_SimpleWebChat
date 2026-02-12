/**
 * Authentication module — MAC + PIN + passphrase verification
 *
 * MAC resolution is done server-side via ARP lookup.
 * The browser never needs to know its own MAC address.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { FacilityUser, UsersConfig } from "./types.js";

/** Path to the users YAML file, set by index.ts after loading */
let usersFilePath: string | null = null;

/**
 * Set the resolved path to the users YAML file for write-back.
 */
export function setUsersFilePath(filePath: string): void {
  usersFilePath = filePath.startsWith("~")
    ? resolve(homedir(), filePath.slice(2))
    : resolve(filePath);
}

/**
 * Load users from YAML config file.
 * Resolves ~ to home directory.
 */
export function loadUsers(filePath: string): FacilityUser[] {
  const resolved = filePath.startsWith("~")
    ? resolve(homedir(), filePath.slice(2))
    : resolve(filePath);

  try {
    const raw = readFileSync(resolved, "utf-8");
    const config = parseYaml(raw) as UsersConfig;

    if (!config?.users || !Array.isArray(config.users)) {
      console.error(`[facility-web] Invalid users.yaml: missing 'users' array`);
      return [];
    }

    // Normalize MAC addresses to lowercase, preserve passphrase and macRequired
    return config.users.map((u) => ({
      ...u,
      mac: (u.mac || []).map((m: string) => m.toLowerCase().trim()),
      pin: String(u.pin),
      passphrase: u.passphrase || undefined,
      macRequired: u.macRequired === true,
    }));
  } catch (err) {
    console.error(`[facility-web] Failed to load users from ${resolved}:`, err);
    return [];
  }
}

/**
 * Save users array back to YAML file.
 */
export function saveUsers(users: FacilityUser[]): boolean {
  if (!usersFilePath) {
    console.error("[facility-web] Cannot save: usersFilePath not set");
    return false;
  }

  try {
    // Build clean YAML structure — strip undefined fields
    const config: UsersConfig = {
      users: users.map((u) => {
        const entry: any = {
          id: u.id,
          name: u.name,
          pin: u.pin,
          mac: u.mac,
          agent: u.agent,
          role: u.role,
        };
        if (u.passphrase) entry.passphrase = u.passphrase;
        if (u.macRequired) entry.macRequired = u.macRequired;
        return entry;
      }),
    };

    writeFileSync(usersFilePath, stringifyYaml(config, { lineWidth: 120 }), "utf-8");
    console.log(`[facility-web] Users saved to ${usersFilePath}`);
    return true;
  } catch (err) {
    console.error(`[facility-web] Failed to save users:`, err);
    return false;
  }
}

// --- Rate limiting (in-memory, per-IP) ---

interface RateLimitEntry {
  attempts: number;
  lockedUntil: number;
}

const rateLimits = new Map<string, RateLimitEntry>();

const MAX_ATTEMPTS = 3;
const LOCKOUT_MS = 30_000;

export function checkRateLimit(ip: string): { allowed: boolean; remainingSeconds?: number } {
  const entry = rateLimits.get(ip);
  if (!entry) return { allowed: true };

  if (entry.lockedUntil > Date.now()) {
    const remaining = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    return { allowed: false, remainingSeconds: remaining };
  }

  // Lockout expired — reset
  if (entry.lockedUntil > 0) {
    rateLimits.delete(ip);
  }

  return { allowed: true };
}

export function recordFailedAttempt(ip: string): void {
  const entry = rateLimits.get(ip) || { attempts: 0, lockedUntil: 0 };
  entry.attempts++;
  if (entry.attempts >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.attempts = 0;
  }
  rateLimits.set(ip, entry);
}

export function clearRateLimit(ip: string): void {
  rateLimits.delete(ip);
}

// --- Passphrase validation ---

export function validatePassphrase(user: FacilityUser, input: string): boolean {
  if (!user.passphrase) return true; // backwards compat: no passphrase set = skip
  return user.passphrase === input.trim();
}

/**
 * Resolve a client IP address to a MAC address via ARP table.
 * Linux only (designed for Jetson / Ubuntu).
 * Returns null if lookup fails.
 */
export function resolveMAC(clientIp: string): string | null {
  try {
    // Use arp command to look up MAC from IP
    const output = execSync(`arp -n ${clientIp}`, {
      encoding: "utf-8",
      timeout: 2000,
    });

    // Parse ARP output for MAC address
    // Format: "192.168.1.100  ether  aa:bb:cc:dd:ee:ff  C  eth0"
    const lines = output.split("\n");
    for (const line of lines) {
      const match = line.match(/([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})/i);
      if (match) {
        return match[1].toLowerCase();
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Authenticate a user by PIN + optional MAC address.
 *
 * Authentication rules:
 * - PIN must match a user record
 * - If user has macRequired=true AND MAC is resolved, MAC must match
 * - If macRequired is false (default), PIN match alone succeeds
 * - If MAC resolution fails (e.g., localhost), PIN-only auth is used
 *
 * Returns the matched user or null.
 */
export function authenticate(
  users: FacilityUser[],
  pin: string,
  clientMac: string | null,
): { user: FacilityUser | null; reason: string } {
  // Find users matching this PIN
  const pinMatches = users.filter((u) => u.pin === pin);

  if (pinMatches.length === 0) {
    return { user: null, reason: "invalid_pin" };
  }

  // If we couldn't resolve MAC (localhost, or ARP failure), allow PIN-only
  if (!clientMac) {
    console.warn(`[facility-web] MAC resolution failed — falling back to PIN-only auth`);
    return { user: pinMatches[0], reason: "pin_only" };
  }

  // Check each PIN match
  for (const candidate of pinMatches) {
    if (!candidate.macRequired) {
      // MAC not required — PIN alone is enough
      return { user: candidate, reason: "pin_only" };
    }
    if (candidate.mac.includes(clientMac)) {
      return { user: candidate, reason: "pin_and_mac" };
    }
  }

  // PIN matched but MAC didn't on a macRequired user
  return { user: null, reason: "mac_mismatch" };
}

/**
 * Scan LAN devices via ARP table.
 * Returns array of {ip, mac} pairs.
 */
export function scanLanDevices(): { ip: string; mac: string }[] {
  try {
    const output = execSync("arp -a", {
      encoding: "utf-8",
      timeout: 5000,
    });

    const devices: { ip: string; mac: string }[] = [];
    const lines = output.split("\n");
    for (const line of lines) {
      // Format: "hostname (192.168.1.50) at aa:bb:cc:dd:ee:ff [ether] on eth0"
      const ipMatch = line.match(/\(([0-9.]+)\)/);
      const macMatch = line.match(/([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})/i);
      if (ipMatch && macMatch) {
        devices.push({ ip: ipMatch[1], mac: macMatch[1].toLowerCase() });
      }
    }
    return devices;
  } catch {
    return [];
  }
}
