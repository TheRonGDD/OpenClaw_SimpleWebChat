/**
 * Facility Web Channel Plugin
 *
 * Registers "facility-web" as a messaging channel in OpenClaw.
 * Manages browser WebSocket connections, authenticates users via MAC+PIN+passphrase,
 * injects inbound messages into the agent pipeline via
 * api.runtime.channel.reply.dispatchReplyFromConfig(), and delivers
 * agent responses back to the browser through a ReplyDispatcher.
 */

import { WebSocketServer } from "ws";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { ChannelPlugin } from "openclaw/plugin-sdk";
import type { FacilityUser, AuthRequest, ChatMessage, AuditQueryRequest, AdminUserSummary } from "./types.js";
import {
  authenticate, resolveMAC, validatePassphrase,
  checkRateLimit, recordFailedAttempt, clearRateLimit,
  saveUsers, scanLanDevices,
} from "./auth.js";
import { WsManager } from "./ws-manager.js";
import type { AuditLog } from "./audit.js";
import { generateImage } from "./imagegen.js";

import { createServer } from "node:http";

/** Default port for the facility-web WebSocket server */
const DEFAULT_WS_PORT = 18790;

/** Passphrase step timeout (5 minutes) */
const PASSPHRASE_TIMEOUT_MS = 5 * 60 * 1000;

/** Resolved account shape for this channel */
interface FacilityAccount {
  accountId: string;
  enabled: boolean;
}

/**
 * Build the channel plugin object.
 * Called from index.ts with the plugin API and loaded user list.
 */
export function facilityWebPlugin(
  api: OpenClawPluginApi,
  users: FacilityUser[],
  auditLog: AuditLog,
): ChannelPlugin<FacilityAccount, unknown> {
  const wsManager = new WsManager(api.logger);
  let connIdCounter = 0;

  return {
    id: "facility-web",

    meta: {
      id: "facility-web",
      label: "Facility Web",
      selectionLabel: "Facility Web Chat",
      blurb: "MAC/PIN authenticated web chat for family members",
      aliases: ["facility", "simpleweb"],
    },

    capabilities: {
      chatTypes: ["direct"],
    },

    config: {
      listAccountIds: () => ["default"],
      resolveAccount: (_cfg, id) => ({
        accountId: id ?? "default",
        enabled: true,
      }),
    },

    gateway: {
      startAccount: async (ctx) => {
        const { account, abortSignal } = ctx;
        const accountId = account.accountId;

        api.logger.info(
          `[facility-web] Starting channel account "${account.accountId}"`,
        );

        // Read plugin config for port
        const pluginConfig = api.config.plugins?.entries?.["facility-web"]?.config as
          | { usersFile?: string; wsPort?: number }
          | undefined;
        const wsPort = pluginConfig?.wsPort ?? DEFAULT_WS_PORT;

        const httpServer = createServer((_req, res) => {
          // This server only handles WebSocket upgrades — reject plain HTTP
          res.writeHead(426, { "Content-Type": "text/plain" });
          res.end("Upgrade Required — this endpoint is WebSocket only");
        });

        const wss = new WebSocketServer({ server: httpServer });

        wss.on("connection", (ws, req) => {
          const connId = `fc-${++connIdCounter}`;
          const clientIp = extractClientIp(req);

          api.logger.debug(
            `[facility-web] New WS connection ${connId} from ${clientIp}`,
          );

          wsManager.addConnection(connId, ws as any, clientIp);

          // Send welcome message
          wsSend(ws, { type: "welcome", version: "0.1.0" });

          ws.on("message", (raw: Buffer | string) => {
            let msg: any;
            try {
              msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
            } catch {
              wsSend(ws, { type: "error", error: "Invalid JSON" });
              return;
            }

            handleBrowserMessage(connId, msg, users, wsManager, api, clientIp, accountId, auditLog);
          });

          ws.on("close", () => {
            api.logger.debug(`[facility-web] WS disconnected: ${connId}`);
            wsManager.removeConnection(connId);
          });

          ws.on("error", (err: Error) => {
            api.logger.debug(`[facility-web] WS error on ${connId}: ${err.message}`);
          });
        });

        // Listen on all interfaces (LAN access)
        httpServer.listen(wsPort, "0.0.0.0", () => {
          api.logger.info(
            `[facility-web] WebSocket server listening on port ${wsPort}`,
          );
        });

        // Keep the channel alive until the gateway signals shutdown.
        // Resolving early causes the gateway to treat the channel as
        // disconnected and trigger auto-restart loops (EADDRINUSE).
        await new Promise<void>((resolve) => {
          abortSignal.addEventListener("abort", () => {
            api.logger.info("[facility-web] Shutting down — closing all connections");
            auditLog.close();
            wsManager.closeAll();
            wss.close();
            httpServer.close();
            resolve();
          });
        });
      },

      stopAccount: async () => {
        wsManager.closeAll();
        api.logger.info("[facility-web] Channel account stopped");
      },
    },

    // Outbound: handle async agent responses (e.g., announce-triggered replies
    // from agent-to-agent messaging that arrive after the original dispatch completes)
    outbound: {
      deliveryMode: "gateway",
      sendText: async ({ to, text }: { to: string; text: string; [k: string]: any }) => {
        api.logger.info(
          `[facility-web] outbound.sendText to=${to} len=${text?.length ?? 0}`,
        );

        // Try to find the connected browser session for this peer
        const sent = wsManager.sendToPeer(to, {
          type: "chat_event",
          event: "agent_push",
          data: text || "",
        });

        if (sent) {
          api.logger.info(`[facility-web] Async push delivered to ${to}`);
        } else {
          api.logger.warn(`[facility-web] No active WS session for ${to}, push not delivered`);
        }

        return { ok: true };
      },
    },
  };
}

/**
 * Resolve the agent ID for a given user.
 * Uses the agent field from users.yaml config.
 */
function resolveAgentId(user: FacilityUser): string {
  return user.agent;
}

/**
 * Build sanitized user list for admin panel.
 */
function buildAdminUserList(users: FacilityUser[]): AdminUserSummary[] {
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    macs: [...u.mac],
    hasPassphrase: !!u.passphrase,
    macRequired: u.macRequired === true,
  }));
}

/**
 * Normalize a MAC address to lowercase colon-separated format.
 */
function normalizeMac(mac: string): string {
  return mac.toLowerCase().trim().replace(/-/g, ":");
}

/**
 * Handle an incoming message from a browser WebSocket.
 */
async function handleBrowserMessage(
  connId: string,
  msg: any,
  users: FacilityUser[],
  wsManager: WsManager,
  api: OpenClawPluginApi,
  clientIp: string,
  accountId: string,
  auditLog: AuditLog,
): Promise<void> {
  const session = wsManager.getByConnId(connId);
  if (!session) return;

  switch (msg.type) {
    case "auth": {
      const authMsg = msg as AuthRequest;

      // Rate limit check
      const rateCheck = checkRateLimit(clientIp);
      if (!rateCheck.allowed) {
        wsSend(session.ws, {
          type: "auth_result",
          success: false,
          error: `Too many attempts. Try again in ${rateCheck.remainingSeconds}s.`,
        });
        return;
      }

      // Resolve MAC address from client IP
      const mac = resolveMAC(clientIp);
      api.logger.debug(
        `[facility-web] Auth attempt from ${clientIp} (MAC: ${mac || "unknown"})`,
      );

      const result = authenticate(users, authMsg.pin, mac);

      if (result.user) {
        // Check if this user needs a passphrase step
        if (result.user.passphrase && (result.user.role === "parent" || result.user.role === "admin")) {
          // Store intermediate state — await passphrase
          (session as any).pinVerified = {
            user: result.user,
            mac,
            timestamp: Date.now(),
          };
          wsSend(session.ws, {
            type: "passphrase_prompt",
            userName: result.user.name,
          });
          api.logger.info(
            `[facility-web] PIN OK for ${result.user.name}, awaiting passphrase`,
          );
        } else {
          // No passphrase needed — complete auth immediately
          clearRateLimit(clientIp);
          wsManager.authenticate(connId, result.user, mac);
          wsSend(session.ws, {
            type: "auth_result",
            success: true,
            user: {
              name: result.user.name,
              id: result.user.id,
              agent: result.user.agent,
              role: result.user.role,
            },
          });
          api.logger.info(
            `[facility-web] Auth OK: ${result.user.name} (${result.reason})`,
          );
        }
      } else {
        recordFailedAttempt(clientIp);
        wsSend(session.ws, {
          type: "auth_result",
          success: false,
          error:
            result.reason === "mac_mismatch"
              ? "This device is not authorized for that PIN."
              : "Invalid PIN.",
        });
        api.logger.info(
          `[facility-web] Auth FAILED from ${clientIp}: ${result.reason}`,
        );
      }
      break;
    }

    case "passphrase": {
      const pinState = (session as any).pinVerified;
      if (!pinState) {
        wsSend(session.ws, { type: "passphrase_error", error: "No pending authentication. Please start over." });
        return;
      }

      // Check timeout (5 minutes)
      if (Date.now() - pinState.timestamp > PASSPHRASE_TIMEOUT_MS) {
        delete (session as any).pinVerified;
        wsSend(session.ws, { type: "passphrase_error", error: "Session expired. Please start over." });
        return;
      }

      // Rate limit check
      const rateCheck = checkRateLimit(clientIp);
      if (!rateCheck.allowed) {
        wsSend(session.ws, {
          type: "passphrase_error",
          error: `Too many attempts. Try again in ${rateCheck.remainingSeconds}s.`,
        });
        return;
      }

      const passphrase = msg.passphrase?.trim();
      if (!passphrase) {
        wsSend(session.ws, { type: "passphrase_error", error: "Passphrase required." });
        return;
      }

      if (validatePassphrase(pinState.user, passphrase)) {
        // Success — complete auth
        clearRateLimit(clientIp);
        delete (session as any).pinVerified;
        wsManager.authenticate(connId, pinState.user, pinState.mac);
        wsSend(session.ws, {
          type: "auth_result",
          success: true,
          user: {
            name: pinState.user.name,
            id: pinState.user.id,
            agent: pinState.user.agent,
            role: pinState.user.role,
          },
        });
        api.logger.info(
          `[facility-web] Passphrase OK: ${pinState.user.name} fully authenticated`,
        );
      } else {
        recordFailedAttempt(clientIp);
        wsSend(session.ws, { type: "passphrase_error", error: "Incorrect passphrase." });
        api.logger.info(
          `[facility-web] Passphrase FAILED for ${pinState.user.name} from ${clientIp}`,
        );
      }
      break;
    }

    case "chat_message": {
      if (!session.user) {
        wsSend(session.ws, {
          type: "error",
          error: "Not authenticated. Please log in.",
        });
        return;
      }

      const chatMsg = msg as ChatMessage;
      const text = chatMsg.text?.trim();
      if (!text) return;

      const user = session.user;
      const agentId = resolveAgentId(user);

      api.logger.debug(
        `[facility-web] Inbound from ${user.name}: ${text.slice(0, 50)}...`,
      );

      // Audit: log inbound child messages
      if (user.role === "child") {
        auditLog.append({
          ts: Date.now(),
          dir: "inbound",
          userId: user.id,
          userName: user.name,
          agent: agentId,
          sessionKey: `agent:${agentId}:facility-web:dm:${user.id}`,
          preview: text.slice(0, 120),
        });
      }

      // Show thinking indicator to the user immediately
      wsSend(session.ws, {
        type: "chat_event",
        event: "thinking",
        data: "Thinking",
      });

      // CHECK RUNTIME API EXISTS
      if (!api.runtime?.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher) {
        api.logger.error(`[facility-web] dispatchReplyWithBufferedBlockDispatcher unavailable`);
        wsSend(session.ws, {
          type: "chat_event",
          event: "error",
          data: "Internal error: dispatch API unavailable",
        });
        return;
      }

      // 2. BUILD THE MESSAGE CONTEXT
      const msgCtx = {
        Body: text,
        BodyForAgent: text,
        BodyForCommands: text,
        From: user.id,                    // e.g., "facility:dad"
        To: "facility-web:bot",
        SessionKey: `agent:${agentId}:facility-web:dm:${user.id}`,
        Provider: "facility-web",
        Surface: "facility-web",
        CommandAuthorized: false,          // Let OpenClaw handle auth
        Timestamp: Date.now(),
        AccountId: accountId,
      };

      // Optionally normalize via finalizeInboundContext if available
      const finalCtx = api.runtime?.channel?.reply?.finalizeInboundContext
        ? api.runtime.channel.reply.finalizeInboundContext(msgCtx)
        : msgCtx;

      // 3. DISPATCH INTO OPENCLAW
      api.logger.info(`[facility-web] Dispatching to agent ${agentId} with sessionKey: ${msgCtx.SessionKey}`);

      try {
        await api.runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
          ctx: finalCtx,
          cfg: api.config,
          dispatcherOptions: {
            deliver: async (payload: any, info: any) => {
              const kind = info?.kind || "final";

              if (kind === "tool") {
                wsSend(session.ws, {
                  type: "chat_event",
                  event: "tool",
                  data: payload.text || "",
                });
              } else if (kind === "block") {
                wsSend(session.ws, {
                  type: "chat_event",
                  event: "token",
                  data: payload.text || "",
                });
              } else if (kind === "final") {
                // Audit: log outbound child replies
                if (user.role === "child") {
                  const replyText = payload.text || "";
                  auditLog.append({
                    ts: Date.now(),
                    dir: "outbound",
                    userId: user.id,
                    userName: user.name,
                    agent: agentId,
                    sessionKey: msgCtx.SessionKey,
                    preview: replyText.slice(0, 120),
                  });
                }

                wsSend(session.ws, {
                  type: "chat_event",
                  event: "done",
                  data: payload.text || "",
                });
              }
            },
          },
          replyOptions: {},
        });
      } catch (err: any) {
        api.logger.error(
          `[facility-web] dispatch failed: ${err.message}`,
        );
        wsSend(session.ws, {
          type: "chat_event",
          event: "error",
          data: `Agent error: ${err.message}`,
        });
      }

      break;
    }

    case "audit_query": {
      if (!session.user) {
        wsSend(session.ws, { type: "error", error: "Not authenticated." });
        return;
      }
      if (session.user.role !== "parent" && session.user.role !== "admin") {
        wsSend(session.ws, { type: "error", error: "Audit access denied." });
        return;
      }

      const aq = msg as AuditQueryRequest;
      const entries = auditLog.query({
        childId: aq.childId,
        since: aq.since,
        until: aq.until,
        limit: aq.limit ?? 50,
      });
      wsSend(session.ws, { type: "audit_result", entries, count: entries.length });
      break;
    }

    case "imagegen": {
      if (!session.user) {
        wsSend(session.ws, { type: "error", error: "Not authenticated." });
        return;
      }

      const prompt = msg.prompt?.trim();
      if (!prompt) {
        wsSend(session.ws, { type: "imagegen_result", error: "Missing prompt" });
        return;
      }

      api.logger.info(`[facility-web] Image gen request from ${session.user.name}: ${prompt.slice(0, 60)}`);

      const result = await generateImage({
        prompt,
        negativePrompt: msg.negative_prompt,
        steps: msg.steps,
        width: msg.width,
        height: msg.height,
      });

      if ("error" in result) {
        wsSend(session.ws, { type: "imagegen_result", error: result.error, prompt });
      } else {
        wsSend(session.ws, {
          type: "imagegen_result",
          url: result.url,
          prompt: result.prompt,
          seed: result.seed,
          elapsed: result.elapsed,
        });
      }
      break;
    }

    // --- Admin handlers ---

    case "admin_get_users": {
      if (!session.user || (session.user.role !== "parent" && session.user.role !== "admin")) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Access denied." });
        return;
      }
      wsSend(session.ws, {
        type: "admin_users_result",
        users: buildAdminUserList(users),
      });
      break;
    }

    case "admin_update_user": {
      if (!session.user || (session.user.role !== "parent" && session.user.role !== "admin")) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Access denied." });
        return;
      }

      const targetId: string = msg.userId;
      const updates = msg.updates || {};
      const target = users.find((u) => u.id === targetId);
      if (!target) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "User not found." });
        return;
      }

      // Validate and apply updates
      if (updates.pin !== undefined) {
        const newPin = String(updates.pin);
        if (!/^\d{4}$/.test(newPin)) {
          wsSend(session.ws, { type: "admin_result", success: false, error: "PIN must be exactly 4 digits." });
          return;
        }
        target.pin = newPin;
      }

      if (updates.passphrase !== undefined) {
        // Only allow setting passphrase on parent/admin users
        if (target.role !== "parent" && target.role !== "admin") {
          wsSend(session.ws, { type: "admin_result", success: false, error: "Passphrases are only for parent/admin users." });
          return;
        }
        // Empty string = clear passphrase
        target.passphrase = updates.passphrase || undefined;
      }

      if (updates.macRequired !== undefined) {
        target.macRequired = updates.macRequired === true;
      }

      const saved = saveUsers(users);
      wsSend(session.ws, {
        type: "admin_result",
        success: saved,
        error: saved ? undefined : "Failed to save changes.",
        users: saved ? buildAdminUserList(users) : undefined,
      });
      break;
    }

    case "admin_add_mac": {
      if (!session.user || (session.user.role !== "parent" && session.user.role !== "admin")) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Access denied." });
        return;
      }

      const target = users.find((u) => u.id === msg.userId);
      if (!target) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "User not found." });
        return;
      }

      const mac = normalizeMac(msg.mac || "");
      if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Invalid MAC address format." });
        return;
      }

      if (!target.mac.includes(mac)) {
        target.mac.push(mac);
        const saved = saveUsers(users);
        wsSend(session.ws, {
          type: "admin_result",
          success: saved,
          error: saved ? undefined : "Failed to save.",
          users: saved ? buildAdminUserList(users) : undefined,
        });
      } else {
        wsSend(session.ws, { type: "admin_result", success: true, users: buildAdminUserList(users) });
      }
      break;
    }

    case "admin_remove_mac": {
      if (!session.user || (session.user.role !== "parent" && session.user.role !== "admin")) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Access denied." });
        return;
      }

      const target = users.find((u) => u.id === msg.userId);
      if (!target) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "User not found." });
        return;
      }

      const mac = normalizeMac(msg.mac || "");
      const idx = target.mac.indexOf(mac);
      if (idx >= 0) {
        target.mac.splice(idx, 1);
        const saved = saveUsers(users);
        wsSend(session.ws, {
          type: "admin_result",
          success: saved,
          error: saved ? undefined : "Failed to save.",
          users: saved ? buildAdminUserList(users) : undefined,
        });
      } else {
        wsSend(session.ws, { type: "admin_result", success: true, users: buildAdminUserList(users) });
      }
      break;
    }

    case "admin_add_current_device": {
      if (!session.user || (session.user.role !== "parent" && session.user.role !== "admin")) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Access denied." });
        return;
      }

      const target = users.find((u) => u.id === msg.userId);
      if (!target) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "User not found." });
        return;
      }

      const currentMac = session.clientMac;
      if (!currentMac) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Could not detect this device's MAC address." });
        return;
      }

      if (!target.mac.includes(currentMac)) {
        target.mac.push(currentMac);
        const saved = saveUsers(users);
        wsSend(session.ws, {
          type: "admin_result",
          success: saved,
          error: saved ? undefined : "Failed to save.",
          users: saved ? buildAdminUserList(users) : undefined,
        });
      } else {
        wsSend(session.ws, {
          type: "admin_result",
          success: true,
          users: buildAdminUserList(users),
        });
      }
      break;
    }

    case "admin_lan_scan": {
      if (!session.user || (session.user.role !== "parent" && session.user.role !== "admin")) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Access denied." });
        return;
      }

      const devices = scanLanDevices();
      wsSend(session.ws, {
        type: "admin_lan_scan_result",
        devices,
        currentMac: session.clientMac,
      });
      break;
    }

    case "admin_add_user": {
      if (!session.user || (session.user.role !== "parent" && session.user.role !== "admin")) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Access denied." });
        return;
      }

      const newUser = msg.user;
      if (!newUser?.id || !newUser?.name || !newUser?.pin || !newUser?.agent || !newUser?.role) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Missing required fields: id, name, pin, agent, role." });
        return;
      }

      if (!/^\d{4}$/.test(String(newUser.pin))) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "PIN must be exactly 4 digits." });
        return;
      }

      if (!["admin", "parent", "child"].includes(newUser.role)) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Role must be admin, parent, or child." });
        return;
      }

      if (users.find((u) => u.id === newUser.id)) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "A user with that ID already exists." });
        return;
      }

      const userEntry: FacilityUser = {
        id: newUser.id,
        name: newUser.name,
        pin: String(newUser.pin),
        mac: [],
        agent: newUser.agent,
        role: newUser.role,
        macRequired: false,
      };

      if (newUser.passphrase && (newUser.role === "parent" || newUser.role === "admin")) {
        userEntry.passphrase = newUser.passphrase;
      }

      users.push(userEntry);
      const saved = saveUsers(users);
      wsSend(session.ws, {
        type: "admin_result",
        success: saved,
        error: saved ? undefined : "Failed to save.",
        users: saved ? buildAdminUserList(users) : undefined,
      });
      if (saved) {
        api.logger.info(`[facility-web] User added: ${userEntry.name} (${userEntry.id})`);
      }
      break;
    }

    case "admin_remove_user": {
      if (!session.user || (session.user.role !== "parent" && session.user.role !== "admin")) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Access denied." });
        return;
      }

      const removeId: string = msg.userId;
      if (!removeId) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Missing userId." });
        return;
      }

      // Prevent removing yourself
      if (removeId === session.user.id) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "Cannot remove your own account." });
        return;
      }

      const removeIdx = users.findIndex((u) => u.id === removeId);
      if (removeIdx < 0) {
        wsSend(session.ws, { type: "admin_result", success: false, error: "User not found." });
        return;
      }

      const removed = users.splice(removeIdx, 1)[0];
      const saved = saveUsers(users);
      wsSend(session.ws, {
        type: "admin_result",
        success: saved,
        error: saved ? undefined : "Failed to save.",
        users: saved ? buildAdminUserList(users) : undefined,
      });
      if (saved) {
        api.logger.info(`[facility-web] User removed: ${removed.name} (${removed.id})`);
      }
      break;
    }

    default:
      api.logger.debug(`[facility-web] Unknown message type: ${msg.type}`);
  }
}

/** Extract client IP from the HTTP request (handles proxies) */
function extractClientIp(req: any): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = (typeof forwarded === "string" ? forwarded : forwarded[0]);
    return first.split(",")[0].trim();
  }
  return req.socket?.remoteAddress?.replace(/^::ffff:/, "") || "unknown";
}

/** Send a JSON message over WebSocket with error handling */
function wsSend(ws: any, data: any): void {
  try {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(data));
    }
  } catch {
    // Connection already closing, ignore
  }
}
