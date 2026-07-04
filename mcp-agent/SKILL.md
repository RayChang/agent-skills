---
name: mcp-agent
description: Scaffold a project-scoped Claude Code subagent that wraps a single MCP server, so the server's tools, token cost, and permission surface exist only inside that agent instead of in every session. Use when asked to "build an MCP agent", "wrap the <X> MCP server", 建立 MCP agent / 封裝 MCP, or when a task needs an MCP server that should not be configured globally. Also use to audit an existing wrapper agent against this spec.
---

# mcp-agent

Scaffold one agent definition file that wraps one MCP server. The template lives in
`references/agent-template.md`; this file is the procedure.

**Hard rules:**
- ADDITIVE ONLY: if the target agent file already exists, switch to audit mode (compare
  against the template's rules, report gaps, change nothing).
- Ask ONE question at a time, each with a recommended default.
- Never write secrets into any file. Auth values are referenced as `${ENV_VAR}` and the
  user sets them in their own shell environment.

## Phase 0 — Decision gate (should this agent exist?)

Build the wrapper only if BOTH hold; otherwise say so and stop:

1. A recurring task class genuinely needs this MCP server's tools.
2. The server would otherwise sit in global or project MCP config, charging every
   session its tool schemas and instruction block regardless of use.

Counter-signal: if nearly every session of this project uses the server, wire it in the
project's `.mcp.json` instead — wrapping would add a dispatch hop for no isolation gain.

## Phase 1 — Gather (detect first, ask only what's missing)

| Field | How to get it |
|---|---|
| `{{SERVER}}` | from the user's request |
| `{{TRANSPORT}}` (`http`/`stdio`) + `{{URL_OR_COMMAND}}` | server docs, or ask |
| `{{HEADER_NAME}}` / `{{ENV_VAR}}` | server docs; propose a conventional env var name |
| `{{TRIGGER}}` | ask: "In one sentence, when should the main conversation dispatch this agent?" — if no one-sentence answer exists, the agent should not exist (report that) |
| `{{TOOLS}}` | the MCP tools the task class needs (not the server's full list), plus the minimal local tools (usually `Read`; add `Bash` only if needed) |
| `{{MODEL}}` | default `sonnet`; `haiku` for purely mechanical operations; `opus` only for judgment-heavy work |

## Phase 2 — Generate

Write `.claude/agents/{{SERVER}}-worker.md` in the project from
`references/agent-template.md`, replacing every placeholder. Unresolvable → literal
`TODO(verify): <what>`; never invent URLs, header names, or tool names.

Design rules the generated file must satisfy (also the audit checklist):

1. One agent wraps ONE server — isolation comes from the 1:1.
2. Server config lives ONLY in the agent's frontmatter — if the same server is also in
   `.mcp.json` or global config, the isolation is fiction; flag it.
3. Secrets only as `${ENV_VAR}` expansion.
4. `description` states WHEN to dispatch it — it is the routing trigger.
5. Hard report caps — raw MCP payloads never flow back to the caller.
6. The agent is an implementer: its results should be checked by a separate context
   (re-read the artifact, re-run the query), never by its own self-assessment.

## Phase 3 — Smoke test (mandatory, before first real use)

1. Confirm the env var is set (`test -n "$ENV_VAR"`); if not, hand the user the exact
   `export` line for their shell profile and pause.
2. Dispatch the new agent once with a trivial read-only task: "List what you can
   access; report in ≤5 bullets."
3. PASS = frontmatter parsed + server connected + env resolved + a sane bullet list.
   FAIL = fix the agent file; do not work around it in task prompts.

Known constraint to verify per environment: agent-frontmatter `mcpServers` support
depends on the Claude Code version (works as of mid-2026; the smoke test is the
authoritative check). Interactively-authenticated servers (browser-login MCPs) fail in
headless/scheduled dispatch — record it in the agent's `description` if it applies.

## Phase 4 — Report (mandatory format)

```
MCP-AGENT REPORT — <server>
File:       .claude/agents/<server>-worker.md (created | audited)
Smoke test: PASS/FAIL + one-line evidence (verbatim)
Env var:    <name> (set by user, not stored)
Dispatch trigger: <the one-sentence description>
NEXT STEPS: <only if any — e.g. unresolved TODO(verify) markers>
```

Print the report verbatim as your final message.
