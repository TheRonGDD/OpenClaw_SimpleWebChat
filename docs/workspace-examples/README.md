# OpenClaw Workspace Examples

Agent workspaces define personality, decision-making, memory, and safety boundaries. This directory contains anonymized examples for **parent** and **child** accounts.

## What is a Workspace?

Each OpenClaw agent has a workspace directory containing:

- **IDENTITY.md** — Agent name, role, communication style, boundaries
- **SOUL.md** — Core values, decision principles, anti-patterns, cognitive style
- **AGENTS.md** — Session behavior, memory rules, response patterns
- **USER.md** — Context about the user (family, infrastructure, preferences)
- **TOOLS.md** — Local, environment-specific configuration and notes
- **MEMORY.md** — Long-term learned facts (can be auto-populated, optional)
- **HEARTBEAT.md** — Session health/debugging (typically minimal)

## File Locations

On the OpenClaw gateway, workspaces live at:
```
~/.openclaw/workspace-{agent-id}/
```

Example:
```
~/.openclaw/workspace-parent/
~/.openclaw/workspace-child-1/
~/.openclaw/workspace-child-2/
```

## Using These Examples

### For Parent/Administrator Agents:
Use `parent-workspace-example.md` as a template. Customize:
1. Agent name and personality
2. Your actual role and communication preferences
3. Family context (other users, systems)
4. Infrastructure and tools
5. Memory rules and decision principles

### For Child Agents:
Use `child-workspace-example.md` as a template. Customize:
1. Agent name and age-appropriate personality
2. Child's name, age, and interests
3. Safety boundaries and escalation procedures
4. Learning/homework protocols
5. Family relationships (referenced, not direct access)

## Web Chat Capabilities

The Facility Web Chat supports formatted output:

- **Images**: Markdown image syntax `![alt](path)` renders inline
- **Code Blocks**: Wrap code with `[CODE:language]...[/CODE]` for formatted display with syntax highlighting and copy button
- **Code blocks are essential** for professional-looking responses when sharing configuration, code, or structured data

See the **parent-workspace-TOOLS.md** for full code block syntax and examples.

## Key Design Principles

### Parent Workspaces
- High autonomy — agents can take initiative
- Full system access — no information hiding
- Technical depth — explain real details
- Personality-driven — be genuine, snarky, helpful
- Leverage web chat formatting (images, code blocks) for clarity

### Child Workspaces
- Strict safety boundaries — all content age-appropriate
- No prompt injection vulnerability — redirect confidently
- Learning-focused — guide instead of answer
- Parental escalation — for serious concerns or complex topics

## Important Notes

1. **Workspace = Persona + Rules**: The workspace files define both personality and guardrails. Keep them in sync.

2. **Safety First for Children**: Child workspaces should include clear escalation procedures. If a child expresses distress, safety overrides personality.

3. **No Cross-Workspace Memory**: Each agent remembers only within sessions (unless explicitly configured). Long-term facts go in MEMORY.md.

4. **PII Handling**: Never store passwords, API keys, or sensitive credentials in IDENTITY.md or AGENTS.md. Use TOOLS.md for local references only.

5. **Character Consistency**: If using a persona (like the examples), never break character unless there's a safety issue.

## Creating Your Own Workspace

1. Copy the relevant example (parent or child)
2. Replace all `[PLACEHOLDER]` sections with your actual content
3. Ensure IDENTITY.md and SOUL.md are consistent
4. Test AGENTS.md session behavior with a few interactions
5. Update USER.md with actual user context
6. Keep TOOLS.md minimal and secure
7. **For parent agents**: Review the code block formatting syntax in TOOLS.md — use it when sharing code, config, or data

## Questions?

Refer to OpenClaw's official documentation or check the parent workspace example for a real-world implementation pattern.
