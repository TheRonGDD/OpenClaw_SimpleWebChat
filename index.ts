import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { facilityWebPlugin } from "./src/channel.js";
import { registerHttpRoutes } from "./src/http.js";
import { loadUsers, setUsersFilePath } from "./src/auth.js";
import { AuditLog } from "./src/audit.js";

const plugin = {
  id: "facility-web",
  name: "Facility Web Chat",
  description: "MAC/PIN authenticated web chat with per-user agent routing",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    // Load user database
    const pluginConfig = api.config.plugins?.entries?.["facility-web"]?.config as
      | { usersFile?: string }
      | undefined;
    const usersFile = pluginConfig?.usersFile || "~/.openclaw/facility-users.yaml";
    const users = loadUsers(usersFile);
    setUsersFilePath(usersFile);

    // Derive the .openclaw base directory from the usersFile config path.
    // This avoids relying on homedir() which breaks when the gateway
    // runs as a different user (e.g., root via sudo).
    const openclawHome = usersFile.startsWith("~")
      ? resolve(homedir(), usersFile.slice(2), "..")
      : resolve(dirname(usersFile));

    const auditDir = resolve(openclawHome, "facility-audit");
    const mediaDir = resolve(openclawHome, "media");
    const auditLog = new AuditLog(auditDir);

    // Register HTTP routes for serving the web UI
    registerHttpRoutes(api, users, auditLog, mediaDir);

    // Register as a messaging channel
    api.registerChannel({ plugin: facilityWebPlugin(api, users, auditLog) });

    api.logger.info(`[facility-web] Plugin loaded. ${users.length} users configured.`);
  },
};

export default plugin;
