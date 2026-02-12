/** Type definitions for Facility Web Chat plugin */

export interface FacilityUser {
  /** Unique peer ID, e.g. "facility:dad" */
  id: string;
  /** Display name */
  name: string;
  /** 4-digit PIN as string */
  pin: string;
  /** Allowed MAC addresses (lowercase, colon-separated) */
  mac: string[];
  /** Target agent ID in OpenClaw */
  agent: string;
  /** Role: admin | parent | child */
  role: "admin" | "parent" | "child";
  /** Passphrase required after PIN for parent/admin auth (if set) */
  passphrase?: string;
  /** Per-user MAC enforcement toggle (default false — PIN-only) */
  macRequired?: boolean;
}

export interface UsersConfig {
  users: FacilityUser[];
}

export interface AuthRequest {
  type: "auth";
  pin: string;
}

export interface AuthResponse {
  type: "auth_result";
  success: boolean;
  userId?: string;
  userName?: string;
  error?: string;
}

export interface ChatMessage {
  type: "chat_message";
  text: string;
}

export interface AgentReply {
  type: "agent_reply";
  text: string;
  delta?: boolean;
}

/** Single audit log entry — one per inbound/outbound child message */
export interface AuditEntry {
  ts: number;
  dir: "inbound" | "outbound";
  userId: string;
  userName: string;
  agent: string;
  sessionKey: string;
  preview: string;
}

export interface AuditQueryRequest {
  type: "audit_query";
  childId?: string;
  since?: number;
  until?: number;
  limit?: number;
}

export interface AuditQueryResponse {
  type: "audit_result";
  entries: AuditEntry[];
  count: number;
}

/** Tracks a connected browser session */
export interface BrowserSession {
  /** WebSocket connection to the browser */
  ws: WebSocket;
  /** Authenticated user (null until auth completes) */
  user: FacilityUser | null;
  /** Client IP address */
  clientIp: string;
  /** Resolved MAC address (null if ARP lookup fails) */
  clientMac: string | null;
  /** Connection timestamp */
  connectedAt: number;
  /** OpenClaw session key after routing */
  sessionKey?: string;
  /** Intermediate state: PIN verified, awaiting passphrase */
  pinVerified?: { user: FacilityUser; mac: string | null; timestamp: number };
}

/** Sanitized user info sent to admin panel (no secrets) */
export interface AdminUserSummary {
  id: string;
  name: string;
  role: "admin" | "parent" | "child";
  macs: string[];
  hasPassphrase: boolean;
  macRequired: boolean;
}
