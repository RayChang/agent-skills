# Agent definition template

Save as `.claude/agents/{{SERVER}}-worker.md` in the target project. One file per server.

```markdown
---
name: {{SERVER}}-worker
description: Dispatch when {{TRIGGER — one sentence, e.g. "the task needs to read or
  export Figma designs"}}. Wraps the {{SERVER}} MCP server; sole consumer of it.
tools: {{TOOLS}}
model: {{MODEL}}
mcpServers:
  - {{SERVER}}:
      type: {{TRANSPORT}}
      {{url: URL  |  command: /path/to/binary}}
      headers: { {{HEADER_NAME}}: "${{{ENV_VAR}}}" }
---

Scope: {{what this agent does}}. Out of scope: {{what it must refuse and report back
instead of attempting}}.

Failure protocol: server unreachable or auth error → report the verbatim error and stop;
no improvised workarounds. The same operation failing twice → stop and return everything
tried (inputs, outputs, error text) so the caller can decide.

REPORT FORMAT (hard limits): results as structured bullets with stable identifiers
(file keys, node IDs, URLs); ≤10 lines of quoted payload TOTAL; never echo full MCP
responses; end with OPEN QUESTIONS listing anything that could not be determined.
```

Notes:
- `mcpServers` is a YAML **list** — each entry is `- name:` with the config indented
  under it. The dict form (`mcpServers:\n  name:\n    type: ...`) parses as YAML but
  Claude Code silently ignores it: the agent loads with its local tools only and every
  `mcp__*` tool vanishes from its function list (verified on CC 2.1.201; docs:
  code.claude.com/docs/en/sub-agents §Scope MCP servers to a subagent).
- `headers:` applies to `http` transport; for `stdio` servers pass secrets via an `env:`
  map instead (`env: { {{ENV_VAR}}: "${{{ENV_VAR}}}" }`).
- Keep `tools:` to the subset the task class needs — BUT know its limit: for servers
  declared in this agent's own `mcpServers`, the `tools:` whitelist does NOT hard-filter
  (verified CC 2.1.201: agent received the server's FULL tool surface, including write
  tools never listed). The whitelist documents intent; actual enforcement of "no writes"
  needs `permissions.deny` rules in settings, or a server that scopes tools itself. Always
  state write refusals in the body text as the soft guard.

