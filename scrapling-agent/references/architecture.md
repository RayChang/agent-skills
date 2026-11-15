# Installation and ownership

The installer keeps the owned package, Python environment and isolated child working directory under `~/.local/share/scrapling-agent/`. It installs the worker at `~/.claude/agents/scrapling-worker.md`, the entry at `~/.local/bin/scrapling-agent`, and discovery links under `~/.agents/skills/` and `~/.claude/skills/`. An externally managed source skill directory and matching relative or absolute discovery symlinks are preserved. If setup is explicitly invoked from a manager-owned directory that replaced a formerly owned link, its external ownership is retained and recorded. `--user-home PATH` selects another user root for isolated setup; `--dry-run` makes no changes.

The launcher runs Claude Code in the owned working directory, using its authentication and the worker's Sonnet model, with session-local tool permissions and normal permission checks. It validates and bounds JSON output; validation does not verify the truth of extracted evidence. Inline MCP tool filtering depends on the installed Claude version and should be checked in the target environment. This is not a security sandbox.

To update, rerun the installer from the updated package. It repairs missing owned files and links, while refusing unowned collisions and existing modified owned files. Restore modified content deliberately before retrying. Each asset is staged in its destination directory for atomic replacement, including destinations on separate filesystems. An edit made during runtime setup is checked again before publication. The `installation.json` manifest records owned file hashes and link targets. For rollback, inspect that manifest and remove only files whose hashes still match and links whose targets still match; preserve modified or external-manager files. Handle the runtime and browser caches separately, and do not remove shared configuration directories. There is no uninstall flag. Interrupted publication records both validated current ownership and intended hashes, so retries can recover even after the source changes. A failed update remains unready until setup succeeds; rerun from the intended source after resolving the reported stage failure.


## Execution and dependencies

Claude Code delegates to the user-level `scrapling-worker`, which declares its own inline Scrapling MCP server. Codex and Copilot invoke the shared executable; it passes the validated installed worker body, model, tools, turn limit and inline MCP command through `--agents` in a separate Claude Code process. It therefore executes that exact definition even with a different `CLAUDE_CONFIG_DIR`, rather than relying on same-name discovery. The worker uses JSON-formatted YAML frontmatter, which Claude Code accepts and the standard-library JSON parser can validate without YAML type coercion. The launcher rejects duplicate keys, incorrect field types and unsupported custom fields, such as additional MCP arguments, instead of silently ignoring them. Neither route registers Scrapling in a parent's MCP configuration. Both routes use Claude authentication and Sonnet; this package does not run the caller's Codex or Copilot model as the website worker.

Setup installs the `scrapling` CLI and `scrapling-mcp` entry in the isolated environment automatically. They need no separate global installation. Browser setup installs both upstream Scrapling's browsers and the compatible Patchright Chromium revision, then checks the Patchright executable. An identical rerun checks browser availability and repairs a missing revision. `--no-browser` skips browser setup and its readiness check.

The worker exposes only its selected Scrapling tools and `StructuredOutput`; it has no filesystem Read, Bash, Write or Edit tool. The launcher explicitly includes `StructuredOutput` in the worker's tool list and child permissions. Claude Code 2.1.323 otherwise omitted schema output for this restricted agent, returning ordinary text instead. The bundled schema uses portable keywords without a dialect URI; independent result validation enforces the caps regardless of the CLI envelope.

For native Claude delegation, session approval must cover the selected Scrapling tools as well as the Agent invocation. In unattended Copilot runs, command approval and access to `~/.local/bin` are separate requirements: allow the installed command with a scoped `shell(<absolute-entry>:*)` rule and add that directory with `--add-dir` if required. Interactive sessions can use their normal approval prompts. No global permission changes are needed.

The MCP tools themselves still accept broader operations, including non-GET requests and browser launch settings. The read-only workflow is an instruction policy, not a server-side network allowlist or a security sandbox. Supplied internal URLs remain supported.

HTTP-first fetching, selectors, session reuse and bounded evidence reduce unnecessary browser work and parent-context payloads. No cross-client latency or accuracy improvement percentage has been measured. Live validation covers macOS arm64; Linux browser system dependencies require verification on the target host.

## Results and process lifetime

The launcher validates the JSON schema and adds semantic checks: `ok` requires a source, evidence must contain non-whitespace text, and all evidence together must fit ten lines. The schema describes the aggregate limits; the launcher enforces them. An `error` field is optional because status, summary and warnings can already describe an extraction failure. Error-envelope subtypes such as `error_max_turns` are preserved without returning raw envelopes or secrets.

Exit codes: 0 ok; 1 extraction/setup/CLI error; 2 usage; 3 partial; 124 timeout; 129 SIGHUP; 130 SIGINT; 131 SIGQUIT; 143 SIGTERM. Callers must give their shell tool more time than `--timeout` (default 180 seconds), including startup and cleanup. A shorter outer timeout or SIGKILL can prevent cleanup.

Inherited ignored signals remain ignored, preserving `nohup` behavior. Handled interruptions and normal completion stop the child's process group, including descendants retaining output pipes. The launcher checks parent completion regardless of pipe activity, stops writers in its group and drains buffered output before returning, rather than waiting indefinitely for inherited pipe EOF. Descendants deliberately creating their own session/process group can escape this cleanup; this launcher does not provide an OS-level process-tree supervisor. Worker session closure remains necessary for browser cleanup. SIGKILL cannot be handled.

## Upstream references

- [Scrapling MCP server](https://scrapling.readthedocs.io/en/latest/ai/mcp-server.html)
- [Scrapling agent skill](https://scrapling.readthedocs.io/en/latest/ai/agent-skill.html)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code programmatic use](https://code.claude.com/docs/en/headless)
