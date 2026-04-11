# OpenClaw Facility Web Chat

A privacy-first web chat plugin for [OpenClaw](https://openclaw.com) that gives
each family member their own AI agent, secured with PIN + passphrase
authentication and an admin panel for credential management.

**Built for parents who run local AI and want safe, per-user access for their
family — no cloud accounts, no external services, no data leaving your network.**

## Features

- **Per-user agent routing** — each family member chats with their own
  dedicated AI agent with a unique personality and safety profile
- **PIN + passphrase authentication** — children use a 4-digit PIN; parents
  add a passphrase for stronger security. MAC address enforcement is optional
- **Admin panel** — parents manage all users' PINs, passphrases, devices,
  and roles from the web UI. Add/remove users, scan LAN for devices
- **Parental audit log** — view children's recent conversations (previews)
  from a slide-out panel. Filter by child and date range
- **Brute-force protection** — 3 failed attempts = 30-second lockout per IP
- **LAN only** — designed for home networks. No internet required for auth
- **Native OpenClaw plugin** — installs as a channel plugin, uses standard
  bindings and session isolation
- **Mobile friendly** — responsive UI works on phones, tablets, and desktops
- **YAML persistence** — admin panel changes write back to the config file

## How It Works

```
Browser → PIN pad → [Passphrase if parent] → WebSocket → Plugin authenticates
  → Routes to correct agent via OpenClaw bindings → Agent responds → Browser
```

The plugin registers as a custom messaging channel (`facility-web`). Each
authenticated user maps to a peer ID that OpenClaw routes to the correct agent
via its standard binding system. Sessions are isolated per user.

## Quick Start

### 1. Install the plugin

```bash
# Copy to OpenClaw extensions directory
cp -r OpenClaw_SimpleWebChat ~/.openclaw/extensions/facility-web

# Install dependencies
cd ~/.openclaw/extensions/facility-web
npm install
```

### 2. Configure users

```bash
cp config/users.example.yaml ~/.openclaw/facility-users.yaml
nano ~/.openclaw/facility-users.yaml
```

Set initial PINs and passphrases. You can manage everything from the admin
panel later, but you need at least one parent/admin account to get started.

```yaml
users:
  - id: "facility:dad"
    name: "Dad"
    pin: "1234"
    passphrase: "change me"     # Required after PIN for parent/admin
    macRequired: false           # Set true to enforce device MAC matching
    mac: []                      # Add devices via admin panel or manually
    agent: "admin-agent"
    role: admin

  - id: "facility:child1"
    name: "Alex"
    pin: "1111"
    macRequired: false
    mac: []
    agent: "child-agent"
    role: child
```

#### Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique peer ID used in OpenClaw bindings (e.g., `facility:dad`) |
| `name` | Yes | Display name shown in the chat UI |
| `pin` | Yes | 4-digit PIN as a string (preserves leading zeros) |
| `passphrase` | No | If set, required after PIN for parent/admin login |
| `macRequired` | No | Default `false`. If `true`, device MAC must match |
| `mac` | No | List of allowed MAC addresses (lowercase, colon-separated) |
| `agent` | Yes | OpenClaw agent ID to route messages to |
| `role` | Yes | `admin`, `parent`, or `child` |

### 3. Add to OpenClaw config

Merge the settings from `config/openclaw.example.json5` into your
`~/.openclaw/openclaw.json`:

```json5
{
  // Enable the plugin
  "plugins": {
    "entries": {
      "facility-web": {
        "enabled": true,
        "config": {
          "usersFile": "~/.openclaw/facility-users.yaml"
        }
      }
    }
  },

  // Register the channel
  "channels": {
    "facility-web": {
      "accounts": { "default": { "enabled": true } }
    }
  },

  // Route users to agents — one binding per user
  "bindings": [
    {
      "agentId": "admin-agent",
      "match": {
        "channel": "facility-web",
        "peer": { "kind": "dm", "id": "facility:dad" }
      }
    },
    {
      "agentId": "child-agent",
      "match": {
        "channel": "facility-web",
        "peer": { "kind": "dm", "id": "facility:child1" }
      }
    }
  ],

  // Session isolation — each user gets their own conversation history
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

**Important:** Every user in `facility-users.yaml` needs a matching binding in
`openclaw.json` that maps their peer ID to an agent. If a binding is missing,
messages won't route.

### 4. Create agents

Each agent needs a workspace directory under `~/.openclaw/agents/`. See
`examples/agents/` for starter configurations:

| Example | Path | Description |
|---------|------|-------------|
| Admin/Parent | `examples/agents/admin-parent/` | Full access, no restrictions, admin panel guidance |
| Child (locked) | `examples/agents/child-locked/` | Strict safety rules, age-appropriate only |
| Service | `examples/agents/service/` | Invisible middleware for defense-in-depth filtering |

Copy an example to create an agent:

```bash
mkdir -p ~/.openclaw/agents/child-agent
cp examples/agents/child-locked/IDENTITY.md ~/.openclaw/agents/child-agent/
```

### 5. Start and connect

```bash
openclaw gateway restart
```

Open: `http://<your-server>:18789/facility-chat/`

## Authentication Flow

### Children
1. Enter 4-digit PIN on the pin pad
2. If `macRequired: true`, device MAC must match (resolved via ARP)
3. Routed directly to chat

### Parents / Admins
1. Enter 4-digit PIN
2. Enter passphrase (if one is set — recommended)
3. Routed to chat with admin panel and audit log access

### Rate Limiting
- 3 failed PIN or passphrase attempts from the same IP = 30-second lockout
- Applies to both PIN and passphrase stages
- Resets on successful authentication
- In-memory only (resets on gateway restart)

### Passphrase Timeout
- After entering a correct PIN, the user has 5 minutes to enter their passphrase
- If the window expires, they must start over from the PIN screen

## Admin Panel

Parents and admins see a gear icon in the chat header. The admin panel lets you:

- **View all users** — dropdown selector shows name and role
- **Change PINs** — enter a new 4-digit PIN for any user
- **Set/clear passphrases** — add passphrase security to parent/admin accounts
- **Toggle MAC enforcement** — enable/disable per-user device checking
- **Manage devices** — view registered MACs, remove them, add the current
  device, or browse all LAN devices via ARP scan
- **Add new users** — fill in peer ID, name, PIN, agent ID, and role
- **Remove users** — delete any user except yourself (with confirmation)

All changes are saved immediately to `facility-users.yaml`.

## Parental Audit Log

Child messages are indexed with 120-character previews in monthly JSONL files
under `~/.openclaw/facility-audit/`. Full transcripts are stored separately
by OpenClaw in agent session files.

**Access methods:**
- **Web UI:** Shield icon in the chat header (parent/admin only). Filter by
  child and date range (24h, 3 days, 7 days, 30 days).
- **HTTP API:** `GET /facility-chat/audit?pin={pin}&child={child_id}&days={n}`
- **WebSocket:** `{"type":"audit_query","childId":"facility:child1","limit":50}`

Audit files are pruned automatically after 6 months.

## Roles

| Role | Chat | Audit Log | Admin Panel | Passphrase |
|------|------|-----------|-------------|------------|
| `admin` | Unrestricted | Yes | Yes | Optional (recommended) |
| `parent` | Unrestricted | Yes | Yes | Optional (recommended) |
| `child` | Agent-defined safety | No | No | N/A |

## Running as a Service

See `examples/systemd/openclaw-gateway.service` for a systemd unit file.

```bash
sudo cp examples/systemd/openclaw-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable openclaw-gateway
sudo systemctl start openclaw-gateway

# View logs
journalctl -u openclaw-gateway -f
```

## Optional: Service Agent for Defense-in-Depth

The child agent's safety rules live in its personality prompt (IDENTITY.md).
A sufficiently clever child could potentially manipulate the agent into
ignoring those rules (prompt injection / jailbreaking).

A **service agent** adds an independent safety layer. It reviews every child
agent response before delivery and can redact policy violations. Even if the
child agent is compromised, the service agent catches it.

### How It Works

```
Child sends message
  → Child agent generates response
  → Service agent reviews response (approve / redact)
  → Approved response delivered to browser
```

The service agent is wired using OpenClaw's `announce` system:

```yaml
# In the child agent's workspace config
announce:
  - event: "before_reply"
    to: "service-agent"
    format: "Review this reply for child safety policy: {reply}"
```

See `examples/agents/service/IDENTITY.md` for the full service agent
personality file with review criteria and response format.

**Trade-offs:**
- Adds latency (every child message goes through an extra LLM call)
- Costs more compute/tokens
- Can use a fast, cheap model since it's a classification task
- Provides real defense against prompt injection

For most families, the locked-down child agent alone is sufficient. The service
agent is for situations where you want belt-and-suspenders protection.

## Network Setup Notes

### MAC Address Resolution
The plugin resolves client MAC addresses via the server's ARP table. This works
when clients are on the same LAN subnet as the server.

**It won't work if:**
- Clients connect through a router/NAT (different subnet)
- The server has multiple network interfaces and ARP tables are segmented
- You're testing from localhost (MAC resolution returns null — falls back to
  PIN-only)

To check what the server sees:
```bash
# On the server
arp -a
```

If MAC resolution isn't reliable on your network, set `macRequired: false` for
all users (the default) and rely on PIN + passphrase instead.

### Ports
| Port | Protocol | Purpose |
|------|----------|---------|
| 18789 | HTTP | OpenClaw Gateway (serves web UI at `/facility-chat/`) |
| 18790 | WebSocket | Facility Web Chat real-time connection |

Both ports must be accessible from client devices on your LAN.

## File Structure

```
OpenClaw_SimpleWebChat/
  index.ts              Plugin entry point
  src/
    auth.ts             Authentication, rate limiting, YAML persistence
    channel.ts          WebSocket channel plugin, message handlers
    ws-manager.ts       Connection tracking
    audit.ts            Audit log indexing
    http.ts             HTTP routes (serves web UI, audit API)
    imagegen.ts         Optional image generation proxy
    types.ts            TypeScript type definitions
  web/
    index.html          Single-page app (login, passphrase, chat, admin)
    chat.js             Client-side JavaScript
    style.css           Styles (dark theme, responsive)
  config/
    users.example.yaml  Example user configuration
    openclaw.example.json5  Example OpenClaw config additions
  examples/
    agents/
      admin-parent/     Full-access parent agent personality
      child-locked/     Strict safety child agent personality
      service/          Defense-in-depth review agent
    systemd/
      openclaw-gateway.service  systemd unit file
```

## Troubleshooting

**"Connecting..." stays on screen**
- Check that the OpenClaw gateway is running
- Verify port 18790 is accessible from the client: `curl http://<server>:18790`
  should return "Upgrade Required"
- Check firewall rules: `sudo ufw status`

**PIN works but "device not authorized"**
- MAC resolution is failing or the device MAC isn't registered
- Check the server's ARP table: `arp -a | grep <client-ip>`
- Either add the MAC to the user's config, or set `macRequired: false`
- Use the admin panel's "Add This Device" button while logged in from that device

**Admin panel changes don't persist**
- Check file permissions on `~/.openclaw/facility-users.yaml`
- The gateway process needs write access to the YAML file
- Check logs: `journalctl -u openclaw-gateway | grep "save"`

**Agent doesn't respond**
- Verify the binding exists in `openclaw.json` for this user's peer ID
- Check that the agent workspace exists under `~/.openclaw/agents/{agent-id}/`
- Look at gateway logs for dispatch errors

**Passphrase screen doesn't appear**
- Only shown for parent/admin users who have a `passphrase` set in the YAML
- Children never see the passphrase screen regardless of config

**Rate limited but haven't tried 3 times**
- Rate limiting is per-IP, not per-user. If multiple people share a NAT/IP,
  their attempts count together
- Lockout lasts 30 seconds and resets on restart

## Requirements

- OpenClaw v2026.2.x or later
- Node.js 22+
- LAN network (for optional ARP-based MAC resolution)
- `ws` and `yaml` npm packages (installed automatically)

## Security Notes

- PINs and passphrases are stored in plain text in `facility-users.yaml`.
  This is intentional for a home LAN setup. **Do not expose this to the internet.**
- MAC addresses can be spoofed. This is "keep honest people honest" security,
  not enterprise grade. For a home with kids, it's sufficient.
- The plugin runs in-process with the OpenClaw Gateway. Treat it as trusted
  code (same as any OpenClaw plugin).
- Sessions are isolated: users cannot see each other's chat history.
- Rate limiting is in-memory and resets when the gateway restarts.
- The admin panel is accessible to any user with role `parent` or `admin`.

## License

MIT
