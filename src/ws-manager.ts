import type { BrowserSession, FacilityUser } from "./types.js";

/**
 * Manages WebSocket connections from browser clients.
 * Maps authenticated peer IDs to their active sessions.
 */
export class WsManager {
  /** Active sessions indexed by peer ID (e.g., "facility:dad") */
  private sessions = new Map<string, BrowserSession>();

  /** All connections (including unauthenticated), indexed by a random conn ID */
  private connections = new Map<string, BrowserSession>();

  private logger: any;

  constructor(logger?: any) {
    this.logger = logger;
  }

  /** Register a new unauthenticated connection */
  addConnection(connId: string, ws: any, clientIp: string): BrowserSession {
    const session: BrowserSession = {
      ws,
      user: null,
      clientIp,
      clientMac: null,
      connectedAt: Date.now(),
    };
    this.connections.set(connId, session);
    return session;
  }

  /** Promote a connection to authenticated */
  authenticate(connId: string, user: FacilityUser, mac: string | null): void {
    const session = this.connections.get(connId);
    if (!session) return;

    session.user = user;
    session.clientMac = mac;

    // Remove any existing session for this peer (old tab, etc.)
    const existing = this.sessions.get(user.id);
    if (existing && existing !== session) {
      this.logger?.debug?.(`[facility-web] Replacing existing session for ${user.id}`);
      try { existing.ws.close(4001, "replaced"); } catch {}
    }

    this.sessions.set(user.id, session);
    this.logger?.info?.(
      `[facility-web] Session authenticated: ${user.name} (${user.id}) from ${session.clientIp}`,
    );
  }

  /** Remove a connection (on disconnect) */
  removeConnection(connId: string): void {
    const session = this.connections.get(connId);
    if (!session) return;

    this.connections.delete(connId);

    // Also remove from authenticated sessions if this was the active one
    if (session.user) {
      const active = this.sessions.get(session.user.id);
      if (active === session) {
        this.sessions.delete(session.user.id);
        this.logger?.info?.(`[facility-web] Session closed: ${session.user.name}`);
      }
    }
  }

  /** Get session by connection ID */
  getByConnId(connId: string): BrowserSession | undefined {
    return this.connections.get(connId);
  }

  /** Get authenticated session by peer ID */
  getByPeerId(peerId: string): BrowserSession | undefined {
    return this.sessions.get(peerId);
  }

  /** Send a message to a specific peer */
  sendToPeer(peerId: string, data: any): boolean {
    const session = this.sessions.get(peerId);
    if (!session?.ws) return false;

    try {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      session.ws.send(payload);
      return true;
    } catch (err) {
      this.logger?.debug?.(`[facility-web] Failed to send to ${peerId}: ${err}`);
      return false;
    }
  }

  /** Get count of active authenticated sessions */
  get activeCount(): number {
    return this.sessions.size;
  }

  /** Get count of all connections (including unauthenticated) */
  get totalCount(): number {
    return this.connections.size;
  }

  /** Close all connections (for shutdown) */
  closeAll(): void {
    for (const [, session] of this.connections) {
      try { session.ws.close(1001, "server shutdown"); } catch {}
    }
    this.connections.clear();
    this.sessions.clear();
  }
}
