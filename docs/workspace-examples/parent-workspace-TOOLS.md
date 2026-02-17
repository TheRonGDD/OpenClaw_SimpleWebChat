# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Environment-specific configuration that would change between installations:

- System and service hostnames/ports
- SSH hosts, aliases, and key locations
- API endpoints and authentication patterns
- Local storage paths and mount points
- Device names and locations
- Preferred tools or scripts
- Credentials references (only patterns, never actual secrets)

## Why Separate This?

Skills are shared. Your setup is yours. Keeping them apart means:
- You can update skills without losing your infrastructure notes
- You can share skills without leaking your infrastructure
- Environment-specific details stay local

## Examples

### SSH Access
```
Primary server: ssh-host.local (key: ~/.ssh/id_ed25519_primary)
Backup server: backup-host.local (key: ~/.ssh/id_ed25519_backup)
```

### Services & Ports
```
Home Assistant: http://localhost:8123 (token-based auth)
Jetson GPU Server: localhost:18789 (local network only)
Ollama inference: localhost:11434 (REST API)
```

### Storage & Mounts
```
Media library: /mnt/media/ (network mount, auto-reconnects)
Backups: /backup/daily/ (local SSD)
Config sync: /home/user/.config/ (git-tracked)
```

### Devices
```
Living room display: display-01.local
Kitchen speaker: speaker-kitchen.local (Piper TTS compatible)
Lab workbench: workbench-pi.local (ESPHome, MQTT)
```

## Formatted Code Blocks — Web Chat Display

The web chat supports formatted code blocks for cleaner output. Use this syntax to display code, JSON, YAML, or formatted text:

### Syntax
```
[CODE:language]
your code or content here
[/CODE]
```

### Why Use Code Blocks?

Instead of plain text code:
```
def hello():
    print("world")
```

Wrap it for proper formatting:
```
[CODE:python]
def hello():
    print("world")
[/CODE]
```

The browser renders it with:
- Monospace font
- Syntax-appropriate styling
- Horizontal scrolling for long lines
- Copy button for easy code sharing

### Examples

**Python code:**

Wrap it with:
```
[CODE:python]
def fibonacci(n):
    a, b = 0, 1
    for _ in range(n):
        print(a)
        a, b = b, a + b
[/CODE]
```

**JSON configuration:**

Wrap it with:
```
[CODE:json]
{
  "host": "localhost",
  "port": 8123,
  "secure": false,
  "entities": ["light.kitchen", "switch.fan"]
}
[/CODE]
```

**YAML automation:**

Wrap it with:
```
[CODE:yaml]
automation:
  - alias: "Morning routine"
    trigger:
      platform: time
      at: "07:00:00"
    action:
      service: light.turn_on
[/CODE]
```

**Bash commands:**

Wrap it with:
```
[CODE:bash]
ssh user@host.local
cd /path/to/project
docker compose up -d
[/CODE]
```

**Markdown (for formatted text with headers, bold, lists):**

Wrap it with:
```
[CODE:markdown]
# Configuration Guide

Set these variables:
- **host**: Server hostname
- **port**: Listen port (default: 8123)
- **timeout**: Request timeout in seconds

Then restart the service.
[/CODE]
```

### Supported Languages
Any language identifier works: `python`, `javascript`, `typescript`, `json`, `yaml`, `bash`, `shell`, `sql`, `html`, `css`, `markdown`, `xml`, `go`, `rust`, `cpp`, etc.

### Guidelines
- Use for code snippets, configuration files, or data structures
- Regular prose should stay as plain text
- Inline code doesn't need wrapping — just use backticks
- Safe alongside regular text in the same response

## Template

Add your own:

```
### [Category]
[Your specific details and references]
```

---

Add whatever helps you do your job. This is your cheat sheet.
