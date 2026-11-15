# Installation and ownership

The installer keeps the owned package, Python environment and isolated child working directory under `~/.local/share/scrapling-agent/`. It installs the worker at `~/.claude/agents/scrapling-worker.md`, the entry at `~/.local/bin/scrapling-agent`, and discovery links under `~/.agents/skills/` and `~/.claude/skills/`. An externally managed source skill directory is preserved. `--user-home PATH` selects another user root for isolated setup; `--dry-run` makes no changes.

The launcher runs Claude Code in the owned working directory, using its authentication and the worker's Sonnet model, with session-local tool permissions and normal permission checks. It validates and bounds JSON output; validation does not verify the truth of extracted evidence. Inline MCP tool filtering depends on the installed Claude version and should be checked in the target environment. This is not a security sandbox.

To update, rerun the installer from the updated package. It refuses unowned collisions and modified owned files; resolve those deliberately before retrying. The `installation.json` manifest records owned file hashes and link targets. For rollback, inspect that manifest and remove only files whose hashes still match and links whose targets still match; preserve modified or external-manager files. Handle the runtime and browser caches separately, and do not remove shared configuration directories. There is no uninstall flag.


## Execution and dependencies

Claude Code delegates to the user-level `scrapling-worker`, which declares its own inline Scrapling MCP server. Codex and Copilot invoke the shared executable; it starts that worker in a separate Claude Code process. Neither route registers Scrapling in a parent's MCP configuration. Both routes use Claude authentication and Sonnet; this package does not run the caller's Codex or Copilot model as the website worker.

Setup installs the `scrapling` CLI and `scrapling-mcp` entry in the isolated environment automatically. They need no separate global installation. Browser setup installs both upstream Scrapling's browsers and the compatible Patchright Chromium revision, then checks the Patchright executable. An identical rerun checks browser availability and repairs a missing revision. `--no-browser` skips browser setup and its readiness check.

The launcher explicitly includes `StructuredOutput` in the worker's tool list and child permissions. Claude Code 2.1.323 otherwise omitted schema output for this restricted agent, returning ordinary text instead. The bundled schema uses portable keywords without a dialect URI; independent result validation enforces the caps regardless of the CLI envelope.

For native Claude delegation, session approval must cover the selected Scrapling tools as well as the Agent invocation. In unattended Copilot runs, command approval and access to `~/.local/bin` are separate requirements: allow the installed command with a scoped `shell(<absolute-entry>:*)` rule and add that directory with `--add-dir` if required. Interactive sessions can use their normal approval prompts. No global permission changes are needed.

HTTP-first fetching, selectors, session reuse and bounded evidence reduce unnecessary browser work and parent-context payloads. No cross-client latency or accuracy improvement percentage has been measured. Live validation covers macOS arm64; Linux browser system dependencies require verification on the target host.

## Upstream references

- [Scrapling MCP server](https://scrapling.readthedocs.io/en/latest/ai/mcp-server.html)
- [Scrapling agent skill](https://scrapling.readthedocs.io/en/latest/ai/agent-skill.html)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code programmatic use](https://code.claude.com/docs/en/headless)
