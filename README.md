# OpenClaw Facility Web Chat

A privacy-first web chat plugin for [OpenClaw](https://openclaw.com) that gives
each family member their own AI agent, secured with PIN + passphrase
authentication and an admin panel for credential management.

### 🛑 CRITICAL SECURITY WARNING

**This plugin must NEVER be exposed to the internet.**  
It is not hardened, not sandboxed, and not designed for hostile networks.  
If you make it publicly reachable, you are effectively giving strangers:

- Access to your family’s AI agents  
- Control of your admin panel  
- Visibility into your children’s chat history  
- A foothold inside your home network  

**If you don’t know exactly what you’re doing, stop now.  
If you *do* know what you’re doing, you still shouldn’t put this on the internet.**

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

## Configuration

### users.yaml

```yaml
users:
  - id: "facility:dad"     # Peer ID (used in bindings)
    name: "Dad"             # Display name
    pin: "1234"             # 4-digit PIN
    mac:                    # Allowed MAC addresses
      - "aa:bb:cc:dd:ee:01"
      - "aa:bb:cc:dd:ee:02"
    agent: "dad-agent"      # OpenClaw agent ID
    role: admin             # admin | parent | child
```

### Roles

| Role    | Description |
|---------|-------------|
| admin   | Full access. Can see system status, manage sessions |
| parent  | Standard access. Unrestricted conversation |
| child   | Safety-first agent with content guardrails |

## Requirements

- OpenClaw v2026.2.x or later
- Node.js 22+
- LAN network (for ARP-based MAC resolution)

## Security Notes

- PINs are stored in plain text in `users.yaml`. This is intentional for a
  home LAN setup. Do not expose this to the internet.
- MAC addresses can be spoofed. This is "keep honest people honest" security,
  not enterprise grade. For a home with kids, it's sufficient.
- The plugin runs in-process with the OpenClaw Gateway. Treat it as trusted
  code (same as any OpenClaw plugin).
- Sessions are isolated: Parents/Admin can view child chat history in the interface.

## License

MIT
