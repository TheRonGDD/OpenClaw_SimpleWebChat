# TOOLS.md - Local Notes

Child workspaces typically have minimal TOOLS.md, as the child does not have system access or infrastructure context. This file is optional.

## What Goes Here

Simple, child-safe reference information that might be useful:

- [Simple local details relevant to the child's environment]
- [Family-safe information about tools or activities]
- [Reminders about your agent's favorite themes or metaphors]
- [Service agent references if your child's agent delegates to other agents]

## What NOT to Put Here

- Infrastructure details (ports, IPs, credentials)
- Sensitive system information
- Anything that would be useful for social engineering
- Anything beyond the child's understanding or interest

## Service Agents

A **service agent** is another AI agent that your child's agent can call upon to handle specific tasks. Common uses:

- **Image Generation**: Calling an image service to create pictures
- **Information Lookup**: Fetching facts from a knowledge service
- **Homework Help**: Specialized agents for math, writing, science, etc.
- **Creative Tasks**: Poetry, story writing, game design assistance

### How Child Agents Use Service Agents

Your child's agent doesn't expose service agent details to the child. Instead, it seamlessly integrates them:

```
Child: "Can you help me write a poem about winter?"
[Your agent calls poetry service agent]
Your agent: "I can help. What do you want the poem to focus on?"
[Continues conversation naturally]
```

From the child's perspective, it's just their agent being helpful.

### Documenting Service Agents in TOOLS.md

If your agent uses service agents, document them here for reference:

```
### Service Agents

#### Image Generation Service
- **Purpose**: Create pictures based on text descriptions
- **How child accesses it**: Asks your agent (e.g., "Can you draw a dragon?")
- **Your agent's response**: Calls image service, returns result to child with commentary
- **Safety note**: All images are filtered for age-appropriateness before showing child

#### Math Tutor Service
- **Purpose**: Help with math homework and explanations
- **How child accesses it**: Asks your agent for math help
- **Your agent's response**: Uses service to verify correct approach, guides child to answer
- **Safety note**: Service provides guidance, your agent ensures child learns (not just gets answers)
```

## Example (Generic)

```
### My Tools

This agent can help with:
- Homework questions (any subject)
- Creative writing and storytelling
- Fun facts and learning
- Brainstorming ideas
- Problem-solving (with guidance, not answers)

Service agents used behind the scenes (child doesn't need to know about these):
- [Service name] for [purpose]
```

---

Add only what helps your agent interact better with the child. Keep it simple and focused.
