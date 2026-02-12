/**
 * Lightweight audit index for children's conversations.
 *
 * Writes ~350-byte JSONL entries to monthly files under
 * ~/.openclaw/facility-audit/. Does NOT duplicate full transcripts
 * (those live in ~/.openclaw/agents/{agent}/sessions/).
 */

import { mkdirSync, appendFileSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { AuditEntry } from "./types.js";

const DEFAULT_RETENTION_MONTHS = 6;
const DAY_MS = 86_400_000;

export class AuditLog {
  private dir: string;
  private retentionMonths: number;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dir: string, retentionMonths?: number) {
    this.dir = dir;
    this.retentionMonths = retentionMonths ?? DEFAULT_RETENTION_MONTHS;
    mkdirSync(this.dir, { recursive: true });

    // Prune on startup, then once a day
    this.prune();
    this.pruneTimer = setInterval(() => this.prune(), DAY_MS);
    // Don't keep the process alive just for pruning
    if (this.pruneTimer.unref) this.pruneTimer.unref();
  }

  /** Append one audit entry to the current month's file. */
  append(entry: AuditEntry): void {
    const file = this.fileForTimestamp(entry.ts);
    appendFileSync(file, JSON.stringify(entry) + "\n");
  }

  /** Query audit entries, newest-first. */
  query(opts: {
    childId?: string;
    since?: number;
    until?: number;
    limit?: number;
  } = {}): AuditEntry[] {
    const { childId, since, until, limit = 50 } = opts;

    const files = this.listFiles();
    const results: AuditEntry[] = [];

    // Iterate files newest-first (they sort lexicographically)
    for (let i = files.length - 1; i >= 0 && results.length < limit; i--) {
      const entries = this.readFile(files[i]);

      // Within each file, iterate newest-first
      for (let j = entries.length - 1; j >= 0 && results.length < limit; j--) {
        const e = entries[j];
        if (childId && e.userId !== childId) continue;
        if (since && e.ts < since) continue;
        if (until && e.ts > until) continue;
        results.push(e);
      }
    }

    return results;
  }

  /** Delete files older than the retention window. */
  prune(): void {
    const cutoff = monthKey(Date.now() - this.retentionMonths * 30 * DAY_MS);
    for (const name of this.listFiles()) {
      // File names are "audit-YYYY-MM.jsonl"
      const key = name.replace("audit-", "").replace(".jsonl", "");
      if (key < cutoff) {
        try {
          unlinkSync(resolve(this.dir, name));
        } catch {
          // ignore — may already be deleted
        }
      }
    }
  }

  /** Flush / cleanup on shutdown. */
  close(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  // --- internals ---

  private fileForTimestamp(ts: number): string {
    return resolve(this.dir, `audit-${monthKey(ts)}.jsonl`);
  }

  private listFiles(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"))
        .sort();
    } catch {
      return [];
    }
  }

  private readFile(name: string): AuditEntry[] {
    try {
      const raw = readFileSync(resolve(this.dir, name), "utf-8");
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEntry);
    } catch {
      return [];
    }
  }
}

function monthKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
