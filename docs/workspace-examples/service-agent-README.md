# Service Agent Workspaces

A **service agent** is a trusted intermediary that provides restricted capabilities on behalf of user-facing agents. Service agents act as a **security boundary** — they allow you to grant child agents access to certain operations (local execution, external lookups, system access) through a **controlled, monitored, whitelisted channel** rather than giving direct capability access.

## The Core Purpose: Capability Delegation with Guardrails

Child agents are intentionally limited — they cannot directly execute local applications, access arbitrary websites, or interact with system resources. A service agent is the **only way** they can perform these operations, and only within strict guardrails:

```
Child Agent (limited capabilities)
    ↓ [restricted request via service call]
Service Agent (trusted gatekeeper)
    ↓ [whitelist check, validation, sandboxing]
System Resource (controlled access)
```

This gives you:
- **Security containment** — if the child is compromised, damage is limited
- **Fine-grained access control** — you decide exactly what operations are allowed
- **Auditability** — every child request goes through a single, logged choke point
- **Flexibility** — update rules/whitelist without changing the child agent

## Common Service Agent Use Cases

### Local Application Execution
The child cannot directly run `exec()`. The service agent validates requests and executes only whitelisted programs.

**Example:**
```
Child: "Can you check the weather for tomorrow?"
→ Child Agent calls Weather Service
→ Service Agent validates: "weather lookup" in whitelist? Yes
→ Service Agent runs: curl weather-api.example.com (sandboxed)
→ Service Agent returns: {temp: 72, forecast: "sunny"}
→ Child Agent: "Tomorrow looks beautiful!"
```

### Whitelisted Website Lookups
The child cannot browse arbitrary websites. The service agent handles lookups of **pre-approved sites only**.

**Example:**
```
Child: "What's the capital of France?"
→ Child Agent calls Info Service
→ Service Agent validates: "wikipedia.org" in whitelist? Yes, "ask.com"? No
→ Service Agent fetches: https://en.wikipedia.org/wiki/France
→ Service Agent extracts fact: "Paris"
→ Child Agent: "The capital of France is Paris."
```

### Homework Assistance (Optional Service)
If you want the child agent to call a specialized tutor service, use the service agent pattern. This ensures the tutor response goes through a validation layer.

**Example:**
```
Child: "Help me with this equation"
→ Child Agent calls Tutor Service
→ Service Agent validates: [age-appropriate? topic allowed?]
→ Service Agent returns hints, not answers
→ Child Agent guides child to solve it
```

## Key Design Principles

1. **Service agents are invisible to users** — end users only see their primary agent's responses
2. **Primary agents format/contextualize results** — they don't expose raw service output
3. **Service agents are functional, not relational** — no personality, no memory between calls
4. **Whitelisting is mandatory** — service agents check requests against explicit allow-lists
5. **All requests are logged** — every operation leaves an audit trail
6. **Service agents are stateless** — each request is independent; no session state

## When to Create a Service Agent

Service agents exist **for child agents**. Parent/admin agents have full system access and don't need capability restrictions.

Create a service agent when a **child agent** needs to:
- Execute local applications or system commands
- Access external services (websites, APIs, databases)
- Access system information or resource status
- Perform operations that require security validation or auditing
- Use capabilities that would be dangerous if granted directly

Do **not** create a service agent when:
- It's for a parent/admin agent (they already have full access)
- The operation can be safely inlined in the child agent
- It doesn't require special security controls or whitelisting
- The child agent can do it directly without security risk

## Design Checklist

When designing a service agent, define:

- **Whitelist** — what operations/URLs/commands are allowed?
- **Input validation** — what constraints/checks must requests pass?
- **Output filtering** — what data should be exposed vs. hidden?
- **Error handling** — how do you fail safely if something goes wrong?
- **Logging** — what should be recorded for audit purposes?
- **Rate limits** — are there per-user or per-operation limits?
