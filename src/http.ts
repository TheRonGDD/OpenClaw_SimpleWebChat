/**
 * HTTP handler — serves the web UI from the Gateway's HTTP server.
 *
 * Uses registerHttpRoute with prefix matching for all /facility-chat/ routes.
 * More specific routes (audit, imagegen, media) are registered first;
 * the static file handler is a prefix catch-all registered last.
 *
 * Routes:
 *   GET  /facility-chat/              → index.html (login + chat SPA)
 *   GET  /facility-chat/style.css     → stylesheet
 *   GET  /facility-chat/chat.js       → client-side JS
 *   GET  /facility-chat/audit?...     → audit log API (parents only)
 *   POST /facility-chat/imagegen      → proxy to local SD image gen service
 *   GET  /facility-chat/media/{file}  → agent-generated images from ~/.openclaw/media/
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { FacilityUser } from "./types.js";
import { authenticate, resolveMAC } from "./auth.js";
import type { AuditLog } from "./audit.js";
import { generateImage } from "./imagegen.js";

// Resolve path to web/ directory relative to this file
const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, "..", "web");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export function registerHttpRoutes(api: OpenClawPluginApi, users: FacilityUser[], auditLog: AuditLog, mediaDir: string) {

  // --- Audit API endpoint ---
  api.registerHttpRoute({
    path: "/facility-chat/audit",
    auth: "plugin",
    match: "prefix",
    replaceExisting: true,
    handler: async (req, res) => {
      const url = req.url || "/";
      const params = new URL(url, "http://localhost").searchParams;
      const pin = params.get("pin");
      if (!pin) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing pin parameter" }));
        return;
      }

      const clientIp = extractHttpClientIp(req);
      const mac = resolveMAC(clientIp);
      const authResult = authenticate(users, pin, mac);

      if (!authResult.user) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authentication failed" }));
        return;
      }

      if (authResult.user.role !== "parent" && authResult.user.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Audit access denied" }));
        return;
      }

      const childId = params.get("child") || undefined;
      const days = parseInt(params.get("days") || "7", 10);
      const limit = parseInt(params.get("limit") || "200", 10);

      const entries = auditLog.query({
        childId,
        since: Date.now() - days * 86_400_000,
        limit,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(entries));
    },
  });

  // --- Image generation proxy endpoint ---
  api.registerHttpRoute({
    path: "/facility-chat/imagegen",
    auth: "plugin",
    match: "exact",
    replaceExisting: true,
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method Not Allowed");
        return;
      }

      const clientIp = extractHttpClientIp(req);
      const mac = resolveMAC(clientIp);

      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        req.on("end", () => resolve(data));
      });

      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      const pin = parsed.pin;
      if (!pin) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing pin" }));
        return;
      }

      const authResult = authenticate(users, pin, mac);
      if (!authResult.user) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authentication failed" }));
        return;
      }

      if (!parsed.prompt || typeof parsed.prompt !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing prompt" }));
        return;
      }

      const result = await generateImage({
        prompt: parsed.prompt,
        negativePrompt: parsed.negative_prompt,
        steps: parsed.steps,
        width: parsed.width,
        height: parsed.height,
      });

      if ("error" in result) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ url: result.url, prompt: result.prompt, seed: result.seed }));
    },
  });

  // --- Media file serving (agent-generated images) ---
  api.registerHttpRoute({
    path: "/facility-chat/media",
    auth: "plugin",
    match: "prefix",
    replaceExisting: true,
    handler: async (req, res) => {
      const url = req.url || "/";
      const mediaPath = url.replace(/^\/facility-chat\/media\//, "").split("?")[0];

      // Security: reject path traversal and empty paths
      if (!mediaPath || mediaPath.includes("..") || mediaPath.includes("\\")) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      const ext = mediaPath.substring(mediaPath.lastIndexOf("."));
      const mimeType = MIME_TYPES[ext];

      // Only serve known image types from the media directory
      if (!mimeType || !mimeType.startsWith("image/")) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Only image files are served from /media/");
        return;
      }

      try {
        const filePath = resolve(mediaDir, mediaPath);
        const content = readFileSync(filePath);
        res.writeHead(200, {
          "Content-Type": mimeType,
          "Cache-Control": "public, max-age=86400",
        });
        res.end(content);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
    },
  });

  // --- Static web UI files (catch-all for /facility-chat/) ---
  api.registerHttpRoute({
    path: "/facility-chat",
    auth: "plugin",
    match: "prefix",
    replaceExisting: true,
    handler: async (req, res) => {
      const url = req.url || "/";

      // Skip WebSocket upgrade requests — handled separately
      if (String(req.headers["upgrade"] ?? "").toLowerCase() === "websocket") {
        return;
      }

      // Redirect /facility-chat to /facility-chat/
      if (url === "/facility-chat") {
        res.writeHead(302, { Location: "/facility-chat/" });
        res.end();
        return;
      }

      // Normalize URL path — strip prefix, default to index.html
      let urlPath = url.replace(/^\/facility-chat\/?/, "/").split("?")[0];
      if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

      // Security: prevent path traversal
      if (urlPath.includes("..")) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      // Determine file extension and MIME type
      const ext = urlPath.substring(urlPath.lastIndexOf("."));
      const mimeType = MIME_TYPES[ext] || "application/octet-stream";

      try {
        const filePath = resolve(WEB_DIR, urlPath.slice(1));
        const content = readFileSync(filePath);
        res.writeHead(200, { "Content-Type": mimeType });
        res.end(content);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
    },
  });

  api.logger.info(`[facility-web] HTTP routes registered at /facility-chat/`);
}

/** Extract client IP from HTTP request (handles proxies) */
function extractHttpClientIp(req: any): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = typeof forwarded === "string" ? forwarded : forwarded[0];
    return first.split(",")[0].trim();
  }
  return req.socket?.remoteAddress?.replace(/^::ffff:/, "") || "unknown";
}
