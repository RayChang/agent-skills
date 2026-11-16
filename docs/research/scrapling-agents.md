# Scrapling for coding agents: capabilities, limits, and adoption evidence

**Research snapshots:** 2026-11-14 and 2026-11-15. **Delivery verification:** 2026-11-16.

**Status:** Implemented as the user-level [scrapling-agent](../../scrapling-agent/SKILL.md)
package in this repository and merged through [PR #22](https://github.com/RayChang/agent-skills/pull/22).
The runtime and all three client routes were exercised on macOS arm64. No controlled
latency, token-savings, precision or recall benchmark has been performed.

This report originated in the temporary Hodmi research worktree. It belongs here because
its subject is reusable coding-agent tooling, rather than the Hodmi application.

**Reading guide:** [Section 14](#14-delivered-implementation-and-validation-2026-11-16)
describes the delivered package, setup, client behavior and tested limits. Sections 1–13
retain the dated primary-source investigation and earlier design decisions. Statements
about work not yet executed in those sections refer to their research phase, not the
current installation. The evaluation plan in section 10 remains unexecuted.

Current implementation details are authoritative in the
[architecture reference](../../scrapling-agent/references/architecture.md),
[installer](../../scrapling-agent/scripts/install.py),
[launcher](../../scrapling-agent/scripts/run.py) and
[final review evidence](../superpowers/plans/2026-11-15-scrapling-review-fixes.md).
The source links below pin the research snapshots; moving `/latest/` documentation is not
an assurance that future upstream behavior remains identical.

## 1. Version and evidence boundary

At the 2026-11-14 research snapshot, GitHub's latest release and PyPI both reported **0.5.1**, published on 2026-11-04. Python **3.10+** is
required. The release tag resolves to commit `3a4bb5b0a008233c85269a0a38a6d08edd4ce329`.
The inspected `main` head was `bb223f2f5fc8f743772751a5ce283ef7851ca6be`, dated 2026-11-11.
Use the release source links below for reproducibility; `/en/latest/` is a moving documentation target.
[GitHub release](https://github.com/D4Vinci/Scrapling/releases/tag/v0.5.1),
[PyPI metadata](https://pypi.org/pypi/scrapling/json),
[release tag API](https://api.github.com/repos/D4Vinci/Scrapling/git/ref/tags/v0.5.1),
[inspected main commit](https://github.com/D4Vinci/Scrapling/commit/bb223f2f5fc8f743772751a5ce283ef7851ca6be).

The reviewed MCP, CLI, parser, storage, conversion, browser-network, browser-configuration, browser-session,
dependency, and benchmark source files were identical between that tag and inspected `main`.
The reviewed MCP guide differed only by adding another demo video. This is a scoped source comparison,
not a statement that every file in the repository is identical.

**Migration matters:** v0.5 removed `DynamicFetcher` and the old MCP bulk tools. Python CDP connections
now use `RemoteSession`/`AsyncRemoteSession`; passing `cdp_url` to `StealthySession` is obsolete.
Examples written for 0.4.15 or earlier require review before reuse.
[Release migration guide](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/docs/migrating-to-v0.5.md).

## 2. Acquisition and execution surfaces

Scrapling supplies HTTP fetching, a Chromium-based stealth browser, HTML parsing, and a Python crawling
framework. Its default lightweight package is primarily the parser; optional extras add the other
surfaces. `scrapling[ai]` adds MCP, Markdown conversion, and fetchers; `scrapling[rag]` adds Markdown and
fetchers; `scrapling[shell]` adds the interactive shell and those fetching/conversion dependencies.
The package exports both `scrapling` and `scrapling-mcp` console commands.
[Pinned package metadata](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/pyproject.toml#L63-L113).

The documented MCP prerequisite is installing the AI extra, followed by `scrapling install` for the
browser and its OS dependencies. That installer invokes Playwright's Chromium installation and
`install-deps chromium`; it is a real environment change, not merely an MCP registration step.
A custom Chromium executable or an existing CDP browser can be used where appropriate.
[MCP installation guide](https://scrapling.readthedocs.io/en/latest/ai/mcp-server.html#installation),
[installer implementation](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/cli.py#L110-L141).

| Surface | What it actually gives an agent | Operational boundary |
|---|---|---|
| MCP | Structured HTTP/browser tools inside an MCP-capable client | Client registration and tool permissions are separate from installing the package |
| CLI | A shell command that writes extracted content to a local file | The agent still needs to read the file; output does not automatically become a chat tool result |
| Official Agent Skill | On-demand documentation, examples, and usage instructions | It teaches the agent; it does not install the runtime or expose MCP tools by itself |
| Python API/spiders | Scripted extraction and concurrent crawling | Requires an explicit script, parsing logic, and concurrency/resource controls |

These are distinct integration surfaces, documented separately by the project.
[MCP guide](https://scrapling.readthedocs.io/en/latest/ai/mcp-server.html),
[CLI guide](https://scrapling.readthedocs.io/en/latest/cli/extract-commands.html),
[Agent Skill guide](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/docs/ai/agent-skill.md),
[Python browser guide](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/docs/fetching/stealthy.md#async-session-usage).

## 3. MCP capabilities and exact limits

The release registers **17 tools**. Grouping them is more useful than treating it as a single browser:

| Group | Released tools | Capability |
|---|---|---|
| One-shot acquisition | `make_request`, `browser_fetch_once` | One URL; HTTP without JavaScript or a rendered browser page |
| Session lifecycle | `browser_open`, `open_request_session`, `list_sessions`, `close_session` | Reuse browser state or HTTP cookies/connections/settings |
| Session acquisition | `browser_fetch`, `session_make_request` | One URL per call through an existing session |
| Read current page | `browser_extract`, `browser_screenshot`, `browser_observe` | Snapshot/HTML/Markdown/text, still images, or short motion observations without navigating again |
| Interaction | `browser_actions`, `browser_evaluate` | Ordered input/wait sequences or JavaScript evaluation |
| Saved authentication | `browser_save_state`, `browser_load_state` | Save/restore browser storage on the MCP server host |
| Background API inspection | `browser_network_requests`, `browser_network_request` | Search retained completed requests and inspect saved request/response details without refetching |

Source: [release tool registrations](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/ai/server.py#L1077-L1187).

**Batch and session boundaries:** `bulk_get`, `bulk_fetch`, and `bulk_stealthy_fetch` were removed.
Fetch tools accept one URL and return one response with `status`, `content`, and `url`; `content` is
itself a list of strings. Repeated fetches can reuse a session, but calls sharing one MCP browser
session must run in order because they share a page. `browser_actions` batches known interaction
steps, not URLs. It stops on its first error, leaves earlier effects in place, and does not retry.
[MCP migration rules](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/docs/migrating-to-v0.5.md#update-tool-names-and-bulk-calls),
[action execution contract](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/ai/server.py#L562-L589).

**Returned-content controls:** acquisition tools default to Markdown and `main_content_only=True`.
`css_selector` narrows matching content after that cleanup. `browser_extract` defaults to a snapshot;
its optional regex `search` works only for snapshots and preserves matching lines, three nearby
lines on each side, and ancestor paths. Snapshot depth is unlimited when omitted; `boxes=False`
can remove geometry. These controls do not impose a token budget or guarantee a small result.
[Fetch parameters](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/ai/server.py#L719-L758),
[current-page extraction](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/ai/server.py#L476-L529),
[snapshot search implementation](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/ai/_snapshot_search.py).

| Limit/default | Meaning |
|---|---|
| HTTP timeout `30` | Seconds; default maximum attempts is 3, with a 1-second retry delay |
| Browser navigation timeout `30000` | Milliseconds; do not copy HTTP timeout units blindly |
| Screenshot | PNG/JPEG; JPEG quality 0–100; a targeted capture cannot also request `full_page` |
| Motion observation | 100–5,000 ms; 2–20 sampled frames; defaults 1,500 ms and 12 frames; not a video-file export |
| Network result page | Default 50 entries, allowed 1–200 per `browser_network_requests` call |
| Retained network history | Default 1,000 requests per browser session; text bodies capped at 1 MiB each and 20 MiB combined; oldest records can be evicted |
| Python network search | Default 100 matches; `limit=None` means all retained matches, not unlimited retention |

Sources: [request/browser parameters](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/ai/server.py#L719-L854),
[screenshot/observe constraints](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/ai/server.py#L617-L716),
[network pagination](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/ai/server.py#L436-L474),
[retention implementation](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/engines/_browsers/_network.py#L9-L115).

Network capture records only completed requests. Failed/unfinished requests are omitted. Supported
text types include HTML, JSON, XML, and JavaScript; binary or unknown bodies can leave metadata and
a `body_note` instead of body text. Reading history or closing the session does not wait for pending
captures. Retention byte limits are not limits on total browser memory or temporary full-body reads.
[Network-history contract](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/docs/fetching/stealthy.md#network-history).

State files contain cookies, local storage, and IndexedDB, excluding `sessionStorage`, open tabs, and
browser settings. Saving overwrites the chosen server-host file. Remote CDP sessions default to a
separate context; `new_context=False` reuses the existing default context/login and preserves it when
disconnecting. That mode inherits its existing context settings rather than applying every local
launch/context option.
[Storage-state API](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/ai/server.py#L357-L382),
[remote-context migration](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/docs/migrating-to-v0.5.md#move-cdp-connections-to-remote-sessions).

The default transport is stdio. Streamable HTTP uses `--http`, defaulting to `127.0.0.1:8000`, and
refuses to start without a bearer token unless `--no-auth` explicitly opts out. The token can come
from `SCRAPLING_MCP_AUTH_TOKEN`; authentication is one shared key, not per-client authorization.
`--allowed-host` enables host-based DNS-rebinding protection. The documented public deployment
requires TLS termination outside the server. These controls matter if adopting remote MCP.
[Transport guide](https://scrapling.readthedocs.io/en/latest/ai/mcp-server.html#authentication),
[release enforcement](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/ai/server.py#L1190-L1252).

## 4. CLI extraction and token filtering

Released extract commands are `get`, `post`, `put`, `delete`, and browser-based `fetch`. They require
a URL and output-file path. File extensions select `.md`, `.html`, or `.txt`; `--css-selector`/`-s`
selects all matching elements. Markdown/text files are UTF-8. These examples are documentation-only:

```bash
scrapling extract get "https://example.com" article.md --css-selector "article" --ai-targeted
scrapling extract fetch "https://example.com" rendered.md --css-selector "main" --ai-targeted
```

Sources: [CLI guide](https://scrapling.readthedocs.io/en/latest/cli/extract-commands.html#available-commands),
[release output conversion](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/shell.py#L617-L732).

`--ai-targeted` is **off by default in the CLI**, whereas MCP acquisition defaults cleanup on.
Cleanup starts at `<body>` when present, strips `script/style/noscript/svg`, removes selected inline
hidden elements, `aria-hidden="true"`, hidden slots, templates, HTML comments, zero-width characters,
and incompatible control characters. Browser AI-targeted extraction also enables ad blocking.
**This is body cleanup, not semantic article extraction:** navigation/footer text can remain, and
selector targeting is still useful. The source applies cleanup before CSS selection, so selectors
for removed/head content will not match with cleanup enabled.
[CLI default](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/cli.py#L239-L250),
[cleanup order and behavior](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/shell.py#L639-L707),
[browser AI-targeted fix in 0.5.1](https://github.com/D4Vinci/Scrapling/releases/tag/v0.5.1).

**Inference from those mechanisms:** smaller output can reduce model input tokens and reading work,
but there is no universal reduction percentage. Savings depend on page markup, selectors, format,
and whether the caller actually sends the entire result to a model. A broad selector can still return
huge content; aggressive filtering can remove useful content. Ad blocking reduces network work only
when blocked resources would otherwise load. The sanitizer is a limited text/DOM filter, not a
guarantee against visible malicious instructions or all CSS-hidden content. Page content remains
untrusted. These limits follow from the explicit inline-style checks and extraction implementation,
not from an independent prompt-injection penetration test.
[Hidden-element checks](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/shell.py#L72-L124),
[extraction implementation](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/shell.py#L667-L707).

## 5. Adaptive selectors: stored similarity, not guaranteed self-repair

Adaptive parsing is an explicit Python workflow: initialize with `adaptive=True`, successfully select
an element with `auto_save=True`, then use `adaptive=True` on a later failed selection. It stores
element properties in SQLite by default and scopes lookup using the website domain and identifier
(normally the selector). `adaptive_domain` can deliberately share that history across changed URLs.
Without prior saved properties, it cannot reconstruct the intended element.
[Adaptive workflow](https://scrapling.readthedocs.io/en/latest/parsing/adaptive.html#how-to-use-adaptive-feature),
[SQLite storage source](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/storage.py#L74-L157).

The release searches the current DOM, scores candidates, and returns the highest-scoring candidate(s)
only if they meet the default **40%** threshold. It saves only the first element from a selection;
combined comma-separated CSS selectors are handled separately. A selector that still matches a wrong
element does not trigger fallback, because relocation happens only when the ordinary selection is
empty. Similarity is therefore not proof of semantic identity. Validate domain-specific invariants,
such as the expected field label, product identifier, value type, and result count.
[Relocation and selection source](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/parser.py#L525-L699),
[documented wrong-match/first-element limits](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/docs/parsing/adaptive.md#troubleshooting).

The built-in MCP `css_selector` interface does not expose the Python `auto_save`, `adaptive`, or
`identifier` controls. Do not assume every MCP selection automatically gains persistent adaptive
recovery simply because Scrapling's Python parser supports it.
[Released MCP fetch signatures](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/ai/server.py#L719-L1035).

## 6. Browser reuse, real parallel batches, and performance claims

HTTP sessions retain connections/cookies; browser sessions avoid repeated browser startup. In the
Python API, `AsyncStealthySession(max_pages=3)` with `asyncio.gather(...)` can fetch multiple URLs using
a reusable tab pool. A free tab is reused; another is opened below the cap; once full, acquisition
waits up to 60 seconds before `TimeoutError`. This explicit Python concurrency differs from MCP's
ordered single-page session workflow. Resource blocking may reduce load time but can break page
loading; it must be checked against extraction completeness.
[Released browser-session guide](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/docs/fetching/stealthy.md#async-session-usage),
[MCP ordering requirement](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/docs/migrating-to-v0.5.md#update-tool-names-and-bulk-calls).

The official parser table reports Scrapling **1.99 ms**, Parsel **2.06 ms**, raw lxml **2.56 ms**,
and BeautifulSoup+lxml **1,562.1 ms** on a 5,000-nested-element text-extraction case. It separately
reports Scrapling **2.3 ms** versus AutoScraper **12.58 ms** for text/similarity search. Those are
maintainer-reported averages over 100 runs, not measurements reproduced in this research.
[Official benchmark table](https://scrapling.readthedocs.io/en/latest/benchmarks.html).

The published script constructs 5,000 **empty nested divs**, warms up the functions, and times them
with **process CPU time**. Different competitors use direct `.text`, descendant `.text()`, or
`.item::text` queries, and there is no assertion that their outputs are equivalent. The similarity
case fetches the books page before timed calls. Therefore the large ratios have substantial task
comparability and representativeness limits; they cannot establish a general parser ranking or a
785× agent speedup.
[Exact benchmark implementation](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/benchmarks.py#L17-L153).

**Assessment:** the code supports plausible savings from targeted extraction, connection/browser
reuse, and fewer agent round trips when actions can be chained. It supplies no general end-to-end
measurement for a coding agent that includes navigation, JavaScript, network delays, anti-bot
failures, model inference, tool latency, retries, and correctness. CAPTCHA/anti-bot support is a
capability claim rather than a guarantee for every site or challenge. Measure task success together
with latency/tokens; a fast incomplete extraction is not an improvement.
[Browser features and caveats](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/docs/fetching/stealthy.md),
[action chaining implementation](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/scrapling/core/ai/server.py#L562-L589),
[benchmark scope](https://github.com/D4Vinci/Scrapling/blob/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/benchmarks.py).

## 7. Initial research verification (2026-11-14)

- Read official latest documentation, GitHub release/tag/main metadata, PyPI metadata, and the pinned
  release source for the claims above.
- Compared the named implementation files and related English guides between the release and
  inspected main head; no implementation differences were found in that scope.
- During this initial research phase, no Scrapling/browser installation, runtime test or MCP
  extraction was performed. Later compatibility tests are recorded in section 14; controlled
  speed and token comparisons remain unmeasured.

## 8. Agent-client integration

At the initial research snapshot, all three inspected clients supported registering a local stdio process. Local help was inspected
without adding a server: Codex CLI 0.166.0, Claude Code 2.1.323 and GitHub Copilot CLI 1.0.107.
This verifies registration syntax, not successful Scrapling startup or extraction.
The following preserve the historical direct-registration alternative, **not executed** and not the delivered default. The selected worker
approach in section 12 avoids registering Scrapling in the main session. Replace the executable path with
that of an isolated environment containing the pinned Scrapling release:

```bash
claude mcp add --transport stdio --scope user scrapling -- /absolute/path/to/venv/bin/scrapling-mcp
codex mcp add scrapling -- /absolute/path/to/venv/bin/scrapling-mcp
copilot mcp add scrapling -- /absolute/path/to/venv/bin/scrapling-mcp
```

| Client | First-party confirmation | Integration notes |
| --- | --- | --- |
| Claude Code | [MCP setup and scopes](https://code.claude.com/docs/en/mcp) | User scope is suitable for a personal utility used across repositories. Use project scope only when intentionally sharing configuration. |
| Codex CLI | [MCP configuration](https://developers.openai.com/codex/mcp/) | The user configuration is `~/.codex/config.toml`; `enabled_tools` can restrict the exposed tool set. Local CLI support does not imply a hosted chat reads this configuration. |
| GitHub Copilot CLI | [Adding MCP servers](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) | `copilot mcp add` writes user configuration at `~/.copilot/mcp-config.json`; `--tools` selects tool names. The interactive `/mcp add` form is also documented. This concerns the standalone CLI. |

Prefer local stdio for an initial pilot: no listening service, shared-server deployment or
cross-client browser ownership is needed. Each agent process may launch a separate server;
this does not create a shared cache or browser session among clients.
Only evaluate a central HTTP service after repeated multi-client use demonstrates a need.

The [official Agent Skill guide](https://scrapling.readthedocs.io/en/latest/ai/agent-skill.html)
provides documentation and examples loaded on demand. It reports testing on Claude Code and
OpenClaw; the research did not verify its installation or runtime behavior on Codex or Copilot.
A skill supplies instructions, while the Python package/CLI or MCP server supplies execution.
Installing the skill files alone does not install browsers or register an MCP server; its setup
instructions do ask the executing agent to install the runtime. Review those steps before use.
Keep the skill version aligned with the pinned library rather than using an unreviewed moving main.

## 9. Recommended workflow and adoption shape

These are engineering recommendations inferred from the documented mechanisms, not measured
performance results. The delivered default is documented in section 14.

1. **Discover the authoritative URL.** Continue using search for discovery and Context7 for
   library documentation. If an official API, Markdown page or feed already exposes the requested
   material, read that directly. Scrapling is an additional acquisition/extraction option.
2. **Try one bounded HTTP request for an unknown site.** Use `make_request` or the CLI `get`,
   verify HTTP status, final URL and expected content. Do not exhaust repeated retries on a
   stable JavaScript shell. Previously classified JavaScript sites can go directly to the browser.
3. **Select before the model reads.** Inspect the document structure and scope to the required
   article, table, heading section or records. Preserve code blocks, table headers, units,
   footnotes and version labels needed for the question. Treat an empty selection as a failure
   to diagnose, not as evidence that the data is absent.
4. **Escalate for JavaScript.** Use `browser_fetch_once` for a single page or an open browser
   session for several related pages. Prefer a known readiness selector over arbitrary long
   sleeps. Re-extract the existing page after interaction rather than loading it again.
5. **Read underlying structured responses when useful.** MCP `browser_open` enables network
   recording internally; its interface has no `record_requests` argument. In Python sessions,
   explicitly enable `record_requests=True` before loading. Locate the relevant completed JSON
   response and inspect only the required fields.
   Confirm its identifiers, pagination, filters and timestamp match the displayed question.
6. **Validate and retain evidence.** Check required fields, record IDs, types, units, duplicate IDs
   and expected counts. Retain the requested/final URL, retrieval time, extraction selector/method,
   source excerpt and any incompleteness warning. A successful response is not proof of complete
   pagination or correct interpretation.
7. **Batch outside the model loop.** For many pages with the same structure, have the agent write
   or reuse a deterministic Python extractor/spider once, then run it with bounded concurrency.
   Return a compact summary and an artifact path rather than every raw page. Preserve sources
   alongside the extracted records. Do not invent removed bulk MCP calls.

Use MCP for interactive, stateful exploration; use CLI plus skill for straightforward shell tasks
and reusable local artifacts; use Python sessions/spiders for repeated structured jobs. The selected
MCP implementation uses the dedicated worker delivered in section 14; section 12 records its earlier design. The official Scrapling skill is useful
when writing extraction code but does not need to be loaded for every ordinary coding task.

A documented shell-only extraction pattern is:

```bash
scrapling extract get "https://example.com/docs/page" article.md --css-selector "article" --ai-targeted
```

The URL and selector are illustrative, not a tested fixture. The CLI's extraction dependencies
must be present; v0.5.1's `[ai]` already supplies them without adding `[shell]` (see section 13).
Use a scoped selector that actually exists on the target site.
The agent can search and read relevant parts of the local artifact rather than loading the whole
file. See the [CLI extraction guide](https://scrapling.readthedocs.io/en/latest/cli/extract-commands.html).

For programmatic jobs, prefer an extraction envelope with `requested_url`, `final_url`,
`fetched_at`, `status`, `selector`, `records`, `evidence` and `warnings`. This envelope and any
cross-run response cache are proposed wrapper behavior, not the built-in MCP response schema.
Session persistence keeps connections/state; it is not a universal content-freshness cache.
A custom cache must account for authentication, locale, query parameters and content freshness.

## 10. Evaluation plan (not executed)

Compare each agent against its own current workflow with the same model/version and instructions.
Do not compare different agents using different models and attribute the result to Scrapling.
Use representative fixtures: static documentation, code-heavy docs, tables with footnotes,
JavaScript-rendered pages, paginated records and a site that normally blocks basic HTTP.
Only use authorized pages; fix the ground truth independently of any candidate extractor.

Compare three variants: current tools; Scrapling MCP with explicit routing/selection;
and CLI/Python with reusable extraction instructions. Use several repeated runs per fixture,
randomize order and report cold browser startup separately from warm-session performance.
Measure:

- Time to the first usable evidence and total time to a correct answer; report distributions.
- Actual model input/output tokens, tool calls, retries and browser launches, where the client
  exposes them. Record unavailable metrics instead of treating bytes or characters as tokens.
- Field precision and recall, pagination completeness, unsupported answer claims and source-link
  correctness against the ground truth. Count wrong-element adaptive matches explicitly.
- Local CPU/memory and setup/maintenance burden, especially when three agents run concurrently.

Adopt for a workload only if accuracy/completeness holds or improves and the observed latency,
token use or reliability justifies the extra runtime. No universal savings target is asserted.
The expected gain is largest when the baseline repeatedly loads browsers, forwards large pages
or asks the model to infer repeated fields. A clean single page already handled well by existing
tools may show little gain or additional overhead.

## 11. Initial client verification and remaining limits

- Resolved Scrapling with Context7 before querying documentation (three commands total).
  Context7 version metadata listed v0.4.15, while retrieved snippets referenced main and v0.5
  migration material; official tagged source and the changelog were used to resolve version claims.
- Inspected the three installed client versions and `mcp add --help`; cross-checked registration
  against the official client documentation linked above.
- At the initial research stage, Scrapling was absent from the inspected Python environment.
  No runtime, browser or MCP execution was performed at that stage. Section 14 supersedes that
  operational gap for the delivered route; anti-bot reliability and controlled performance
  comparisons remain unverified.
- Documentation-only changes in an isolated worktree; no application, schema, infrastructure,
  account configuration, commit, push or deployment change.
- In the initial 2026-11-14 report, all 25 distinct linked source targets returned successful HTTP HEAD responses (fragments were not
  independently checked). All three fenced shell examples passed `zsh -n`; this checks syntax only.
  `git diff --check` and a separate whitespace check covering the new report passed.

## 12. Historical worker design decision (2026-11-15)

The maintainer selected the
[`mcp-agent` skill](https://github.com/RayChang/agent-skills/blob/main/mcp-agent/SKILL.md)
and its [agent template](https://github.com/RayChang/agent-skills/blob/main/mcp-agent/references/agent-template.md).
The skill scaffolds a **Claude Code** agent wrapping one MCP server. It is not a portable agent-file
format for all three clients. This section records the design-only proposal. Section 14
supersedes its project-scoped placement and untested bridge with the delivered user-level package.

### Worker contract

Proposed role: `scrapling-worker`. Dispatch when a task needs to retrieve and extract evidence from
specified website URLs, including JavaScript-rendered content. Search-based discovery and
library-documentation lookup remain with the caller's existing tools. This is a recurring side task
suited to the skill's isolation goal; it is not required for every coding conversation.

```text
Caller: URLs + question/fields + page/output limits
    -> scrapling-worker: owns Scrapling MCP for the task
        -> HTTP first, browser when needed, scoped extraction, validation
    <- bounded findings + source URLs + short evidence + warnings
Caller: independently checks decisive evidence and composes the answer
```

The worker owns HTTP/browser selection, readiness checks, session reuse and cleanup. Keep browser
navigation within one MCP session ordered. Raw HTML, large snapshots and network histories stay
inside its context; a suggested report cap is five findings and ten quoted lines total, with source
URLs, retrieval time and explicit missing/partial-data warnings. Preserve decisive units, footnotes
and version labels. This cap is a proposed worker instruction, not a measured or server-enforced
token limit.

For Claude Code, the proposed project file is `.claude/agents/scrapling-worker.md`, with model
`sonnet` as the skill's default. Use an inline stdio Scrapling server in the **list-shaped**
`mcpServers` frontmatter. Local stdio Scrapling does not require an API-key/header variable;
the skill's secret-variable check is inapplicable to this transport unless credentials are added
later. Resolve the executable path from the installed environment rather than guessing it.
Register Scrapling only there, then check for duplicate main-session/global registration.

Start with the HTTP/session and browser fetch/extract tools required for reading pages. Add browser
interaction or network inspection when a concrete task needs them. The template records an older
Claude Code limitation where a `tools` list did not filter inline-server tools; therefore verify the
actual tool inventory and permissions in the installed version. A role named "read-only" or a
written restriction alone does not establish a tool-enforced restriction, especially because
Scrapling's `make_request` also accepts mutating HTTP methods.
[Template caveat](https://github.com/RayChang/agent-skills/blob/main/mcp-agent/references/agent-template.md),
[Scrapling MCP signatures](https://scrapling.readthedocs.io/en/latest/api-reference/mcp-server.html).

### Client-specific implementation boundary

| Client | Verified behavior | Consequence for this proposal |
| --- | --- | --- |
| Claude Code | Inline agent `mcpServers` connect when the agent starts and disconnect on completion; the parent does not receive those tools. Agent files also work with `claude --agent`. | The selected skill maps directly to this client. Project-file trust and a real dispatch must still be tested. |
| Codex CLI | The custom-agent docs inspected for this research say `mcp_servers` in an agent file does not override the parent configuration. | A native custom role using parent-configured MCP does not satisfy the same MCP-configuration isolation goal. |
| Copilot CLI | Custom agents and MCP registration are documented. The `mcp-servers` profile examples consulted describe cloud-agent configuration, rather than proving isolated standalone-CLI server startup. | Treat exact per-agent MCP lifecycle as unverified; do not claim Claude's frontmatter works unchanged. |

Sources: [Claude subagent MCP scope and trust](https://code.claude.com/docs/en/sub-agents#scope-mcp-servers-to-a-subagent),
[Codex custom-agent configuration](https://developers.openai.com/codex/subagents/),
[Copilot CLI custom agents](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents),
[Copilot profile reference](https://docs.github.com/en/copilot/reference/custom-agents-configuration),
[Copilot MCP surface distinctions](https://docs.github.com/en/copilot/concepts/customizations/mcp).

If identical isolation is required across clients, a **proposed bridge** is for Codex or Copilot to
launch a separate Claude worker process using the same worker definition. Only that process
loads Scrapling; it returns the bounded report to the calling CLI. Claude documents running an agent
as the main session with `--agent`, including inline MCP startup. The cross-client invocation,
authentication, permission handling, output capture and cleanup have not been tested here.
This bridge requires Claude Code and its authenticated runtime even when Codex/Copilot is the caller.
It adds a dispatch/model/process cost; it is not a native Codex/Copilot agent-file conversion.

### Expected benefit and acceptance before activation

The strongest expected gain is keeping fetched pages and exploratory tool results out of the
caller's context. Do not assume every globally configured MCP currently loads every full schema:
Claude's tool search already defers tool definitions on supported configurations. Worker startup
and summarization can increase total model tokens or latency even while shrinking the main context.
Measure both main-context usage and total billed usage/time against the existing baseline.
[Claude MCP tool search](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search),
[subagent context and usage](https://code.claude.com/docs/en/sub-agents).

The selected skill requires a smoke test **before first real use**. After installing the pinned
runtime and creating the actual agent file, dispatch a small read-only task. Verify that the file
parses, the server connects, the intended tools work, the parent lacks Scrapling tools, cleanup
occurs and the report respects its cap. Independently check one cited result against its source.
For a project agent, check trust for the exact directory; non-interactive print mode is not by itself
proof that inline project servers are trusted. A parsed YAML file or MCP tool list alone is not a
successful smoke test.

That update selected the architecture only. No agent file, adapter, runtime installation or
dispatch smoke test had been performed at that stage. Delivery and validation followed in section 14.
The updated report's 33 distinct source targets passed HTTP HEAD checks; fragments were not checked.
The three existing shell examples passed `zsh -n`; tracked/new-report whitespace checks passed.


## 13. AI integration pages deep audit (2026-11-15)

Research date: 2026-11-15. Scope: the complete official [MCP guide](https://scrapling.readthedocs.io/en/latest/ai/mcp-server.html) and [Agent Skill guide](https://scrapling.readthedocs.io/en/latest/ai/agent-skill.html), the skill entry point, relevant bundled references, all four bundled Python examples, and runtime source. Source snapshot: [`bb223f2f5fc8f743772751a5ce283ef7851ca6be`](https://github.com/D4Vinci/Scrapling/commit/bb223f2f5fc8f743772751a5ce283ef7851ca6be). Both the repository and [published PyPI metadata](https://pypi.org/pypi/scrapling/0.5.1/json) identify version 0.5.1.

Status labels in this dated audit: **Verified** means documentation/source verification; **Inference** means a conclusion from that evidence; **Not executed** refers to this audit phase. Runtime provisioning and execution subsequently occurred as documented in section 14.

### MCP and the official skill solve different layers

**Verified:** MCP supplies callable scraping/browser tools. The skill supplies Markdown API guides and examples to a coding agent, including CLI usage, Python programs, spiders, and a reference about MCP itself. They can be used together; installing the skill does not itself register an MCP server. [Official distinction](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/docs/ai/agent-skill.md#L8-L12), [skill reference routing](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/agent-skill/Scrapling-Skill/SKILL.md#L427-L438).

**Verified:** The official name is `scrapling-official`. Its metadata and entry point describe Python and CLI work; they do not define a subagent, prescribe delegation, or create an isolated agent context. The authors explicitly report testing the skill on **OpenClaw and Claude Code**. General AgentSkills readability is a broader compatibility statement, not evidence of author testing on every host. [Entry point](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/agent-skill/Scrapling-Skill/SKILL.md), [tested hosts](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/docs/ai/agent-skill.md#L36-L42).

**Inference:** A parent agent can delegate either MCP calls or skill-guided Python work, but the host orchestration must provide that delegation. Neither product intrinsically promises a short synthesized report returned from a separate subagent.

### Skill installation and runtime setup are separate

**Verified:** The documented skill installation copies the skill through Skills.sh, Clawhub, or manual extraction. Applying this workspace's package-runner rule, its Skills.sh command would be:

```bash
bunx skills add D4Vinci/Scrapling --skill scrapling-official
```

The official page says the CLI detects installed agents and adds the skill to them; it does not document this step as installing the Scrapling Python package. [Installation methods](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/docs/ai/agent-skill.md#L14-L34).

**Verified:** Once an agent reads the skill, its setup section explicitly instructs it to create a virtual environment, run `pip install "scrapling[all]>=0.5.1"`, and run `scrapling install --force` for browser fetching. Thus “installing skill files does not provision the runtime” is accurate; “the skill never tells the agent to install the runtime” is inaccurate. Installation instructions can lead to later agent actions subject to host permissions. [Setup instructions](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/agent-skill/Scrapling-Skill/SKILL.md#L39-L62).

**Verified:** The browser installer is a separate operation: source invokes Playwright's Chromium download and `install-deps`, then refreshes the TLD list. Official CLI documentation says HTTP requests do not need this step. An installed Python extra therefore does not prove Chromium or OS browser dependencies exist. [Installer implementation](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/scrapling/cli.py#L110-L139), [HTTP/browser distinction](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/docs/cli/overview.md#L26-L35).

### Correction: `[ai]` does not additionally require `[shell]` for extraction

**Verified:** Official CLI documentation recommends `[shell]` for that documentation section, while the MCP guide recommends `[ai]`; the skill recommends the broader `[all]`. These recommendations are not a complete account of minimum import requirements. [CLI recommendation](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/docs/cli/overview.md#L26-L35), [MCP installation](https://scrapling.readthedocs.io/en/latest/ai/mcp-server.html#installation).

| Extra | Declared additions relevant here |
|---|---|
| `fetchers` | Click, HTTP/browser engines, and supporting packages |
| `rag` | `fetchers` plus `markdownify` |
| `ai` | `fetchers` plus `markdownify` and `mcp` |
| `shell` | `fetchers` plus `markdownify` and IPython |
| `all` | `ai` plus `shell` |

The [dependency declarations](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/pyproject.toml#L72-L100) match [PyPI 0.5.1 metadata](https://pypi.org/pypi/scrapling/0.5.1/json).

**Verified:** `scrapling extract` imports `Convertor` from `core.shell`, but that module imports IPython only inside `CustomShell.__init__`. Markdown conversion separately imports `markdownify`. Therefore importing the conversion helper does **not** require initializing the IPython shell. [Extraction path](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/scrapling/cli.py#L42-L61), [deferred IPython import](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/scrapling/core/shell.py#L434-L448), [Markdown dependency](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/scrapling/core/shell.py#L617-L636).

**Inference, not executed:** A working `[ai]` installation already supplies the declared dependencies for CLI extraction, including Markdown. Adding `[shell]` solely for `extract` is unnecessary at this snapshot; add it for `scrapling shell`, or use `[all]` to follow the skill's full setup. `[rag]` is another declared bundle for extraction without MCP. This was a source/import audit, not a fresh-environment smoke test.

### Limits that affect implementation choices

- **Verified:** CLI sanitization is opt-in with `--ai-targeted`; the skill requires that flag. MCP extraction normally uses `main_content_only=true`. This selects the HTML body and applies noise/hidden-content filters; it is not an article-relevance detector. **Inference:** Visible malicious instructions and content outside those filters remain untrusted. [CLI requirement](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/agent-skill/Scrapling-Skill/SKILL.md#L37), [filter implementation](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/scrapling/core/shell.py#L638-L705).
- **Verified:** MCP is also an interactive browser interface with actions and arbitrary page JavaScript, not only a read-only fetch API. Persistent sessions must be closed explicitly; standalone fetches close their own resources. Saved browser state resides on the MCP host and omits sessionStorage, tabs, and browser settings. [MCP capabilities and lifecycle](https://scrapling.readthedocs.io/en/latest/ai/mcp-server.html#features).
- **Verified:** Network history retains completed requests with supported textual response bodies, subject to limits; incomplete requests and some bodies are omitted. It is not complete network capture. HTTP transport requires a shared bearer token unless explicitly disabled; rotation requires restarting, and TLS termination is a separate deployment concern. [History limits](https://scrapling.readthedocs.io/en/latest/ai/mcp-server.html#network-history), [authentication](https://scrapling.readthedocs.io/en/latest/ai/mcp-server.html#authentication).
- **Verified:** MCP `browser_open` has no `record_requests` parameter: it sets `record_requests=True` internally for both local and remote sessions. Do not copy Python session examples' explicit recording flag into the MCP tool call. [Signature and constructors](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/scrapling/core/ai/server.py#L281-L355).
- **Verified:** The bundled examples are ordinary Python scripts for HTTP sessions, browser sessions, and spiders. They demonstrate mechanics on a practice website, rather than prove success on a target site's current defenses. The skill also limits external documentation searches without user permission. [Examples](https://github.com/D4Vinci/Scrapling/tree/bb223f2f5fc8f743772751a5ce283ef7851ca6be/agent-skill/Scrapling-Skill/examples), [reference policy](https://github.com/D4Vinci/Scrapling/blob/bb223f2f5fc8f743772751a5ce283ef7851ca6be/agent-skill/Scrapling-Skill/SKILL.md#L427-L445).

**Recommended decision:** Choose MCP when the agent should immediately operate standardized scraping/browser tools. Add the skill when it should write or maintain reusable Scrapling programs. Configure subagent orchestration separately if context isolation and a summarized return are requirements. Keep runtime/browser provisioning explicit in any installation plan.

### Integration implications for the selected worker

Keep the three components separate:

| Component | Responsibility | What installing/creating it does not establish |
| --- | --- | --- |
| `mcp-agent` | Scaffold the dedicated agent, its dispatch trigger, bounded report and verification workflow | A running Scrapling server or Python/browser installation |
| `scrapling-official` | Teach CLI/Python/MCP usage with versioned references and examples | Automatic subagent creation or guaranteed runtime readiness |
| Scrapling MCP | Execute HTTP/browser operations and maintain task sessions | The worker's routing policy, output cap or independent evidence review |

The official skill supports a CLI/Python route that does not require MCP. For the maintainer's chosen
MCP route, it can supplement the worker rather than replace its definition. Simple retrieval can
use short explicit worker instructions and consult only the relevant MCP reference. Reserve the
broader skill/code examples for extraction scripts, adaptive parsing or spiders. This is a context
budget recommendation, not an official requirement to install both integrations.

For Claude Code, listing `scrapling-official` under the worker's `skills:` would preload its **entire
entry-point content** at worker startup; reference files remain separate. It is not zero-cost
on-demand loading of every part of the skill. Preloading is an option after the skill is installed,
not a required step for MCP scraping. The full skill includes one-time installation instructions,
so a preconfigured worker should receive an explicit runtime-ready contract and use the selected
MCP execution route. It should report a missing runtime instead of treating a scraping request as
authorization to install or change the environment.
[Claude skill preloading](https://code.claude.com/docs/en/sub-agents#preload-skills-into-subagents).

Keep the local stdio worker as the default proposal. Native Python, Docker and remote HTTP are
alternative deployment choices, not three prerequisites. With a remote HTTP MCP service, the
client machine does not need the local Scrapling CLI. Connecting to a remote CDP browser is a
separate choice: it moves browser execution while the Scrapling MCP server still runs somewhere.
One installed runtime can serve several sequential local workers; that does not imply they share
a single process, browser, cookies or response cache.
[MCP deployment modes](https://scrapling.readthedocs.io/en/latest/ai/mcp-server.html#setting-up-the-mcp-server).

Prefer `make_request` for a standalone static page. For related pages choose a reusable HTTP
session, escalating to a browser session only when required. Once a browser page is loaded,
`browser_extract` and targeted screenshots read current state without reloading. Chain known actions
and waits in one `browser_actions` call to reduce model round trips, but inspect a changed page before
assuming unknown next steps. Network-history reads reuse recorded responses; a missing or evicted
body is not evidence that the request never happened. These are concrete mechanisms for reducing
work; none supplies a universal latency or token-reduction percentage.
[MCP tools and best practices](https://scrapling.readthedocs.io/en/latest/ai/mcp-server.html#best-practices).

Audit verification: all 42 distinct source targets in the combined report returned successful HEAD
responses (fragments not checked); all four shell examples passed `zsh -n`, and tracked/new-report
whitespace checks passed. These were documentation-audit checks at that stage. Runtime evidence now appears in section 14; the controlled performance evaluation remains unexecuted.


## 14. Delivered implementation and validation (2026-11-16)

The implementation was merged into this repository through
[PR #22](https://github.com/RayChang/agent-skills/pull/22), including review fixes in
[commit 66b7797](https://github.com/RayChang/agent-skills/commit/66b779764be10ba94f16505f430a3303dc4ded47).
The [delivery plan](../superpowers/plans/2026-11-15-scrapling-agent.md) records the initial
work, and the [review-fixes record](../superpowers/plans/2026-11-15-scrapling-review-fixes.md)
contains the final acceptance evidence. This section supersedes earlier proposal-only
statements about deployment and operational compatibility.

### Scope and execution

The package is **user-level and reusable across projects**. It is independent of Hodmi,
and the installed command does not depend on retaining the original research or implementation
worktree. The installer owns a self-contained copy under the user's data directory.

```text
Claude Code -> foreground scrapling-worker -> its inline Scrapling MCP server
Codex / Copilot -> scrapling-agent CLI -> same Claude Sonnet worker and MCP tools
```

Claude Code delegates natively and waits for the completed report. Codex and Copilot run
an isolated Claude Code process through the shared launcher. All three routes therefore
require authenticated Claude Code and use the worker's Sonnet model; the caller's Codex
or Copilot model does not become the website worker. No native Codex/Copilot per-agent MCP
lifecycle equivalence is claimed. No parent/global Scrapling MCP registration is required.

The generated worker uses JSON-formatted YAML frontmatter. The launcher parses that with
strict JSON types and duplicate-key checks, then passes the validated body, model, tools,
turn limit and inline MCP definition through `--agents`. Unsupported custom configuration
is rejected rather than silently ignored or resolved through another same-named agent.
See the [worker template](../../scrapling-agent/agents/scrapling-worker.md.tmpl) and
[launcher](../../scrapling-agent/scripts/run.py).

### Setup and installed artifacts

Setup requires `uv` and an authenticated Claude Code installation. From this repository's
root, explicitly run:

```bash
python3 scrapling-agent/scripts/install.py --dry-run
python3 scrapling-agent/scripts/install.py
~/.local/bin/scrapling-agent --url https://example.com --task "Summarize the main content with evidence"
```

| Artifact | User-level destination |
| --- | --- |
| Owned package and work directory | `~/.local/share/scrapling-agent/` |
| Python 3.13 runtime | `~/.local/share/scrapling-agent/.venv/` |
| Native Claude worker | `~/.claude/agents/scrapling-worker.md` |
| Shared command | `~/.local/bin/scrapling-agent` |
| Skill discovery | `~/.agents/skills/scrapling-agent`, `~/.claude/skills/scrapling-agent` |

The installer pins `scrapling[ai]==0.5.1`. It installs the `scrapling` CLI and
`scrapling-mcp` inside that environment, so no additional global Scrapling CLI installation
is needed. Browser setup installs and verifies the compatible Patchright Chromium as well
as running upstream Scrapling setup; the initial live test exposed differing Playwright
and Patchright revisions. `--no-browser` is an explicit HTTP-only setup option. Ordinary
extraction does not install dependencies, change authentication or edit shell startup files.

Setup preserves external-manager directories and matching aliases, repairs missing owned
files, and refuses to overwrite existing user edits or unrelated files. Its ownership journal
supports retry after interrupted publication, including changed source versions. Each file
is published atomically on its destination filesystem; an incomplete update stays unready
until setup succeeds. Details and rollback guidance are in the
[architecture reference](../../scrapling-agent/references/architecture.md).

### Extraction policy and enforced limits

The selected worker exposes 13 of Scrapling's 17 MCP tools plus `StructuredOutput`. It has
no filesystem `Read`, Bash or Edit tool. HTTP-first selection, targeted extraction, browser
fallback, session reuse/closure and retaining decisive source context are worker instructions.
The full official `scrapling-official` skill is not preloaded for routine reads.

The launcher independently enforces its [result contract](../../scrapling-agent/schemas/result.schema.json):
`status`, `summary`, `sources`, `warnings` and optional `error`; summary at most 6,000
characters; at most five sources and 2,000 evidence characters per source; nonblank evidence;
ten evidence lines across sources; and at least one source for `ok`. Five findings is a
worker instruction rather than a semantic count enforced on the summary string.

Captured stdout and stderr are each capped at 1 MiB. Timeout defaults to 180 seconds.
Handled HUP/INT/QUIT/TERM signals clean the child process group while preserving inherited
ignored signals. Completion detection drains buffered output even when descendants retain
pipes. Error diagnostics preserve subtype and redact common credential forms. Callers must
give their outer shell tool more time than the launcher's timeout, including cleanup.

### Recorded delivery checks

These are completed delivery checks, separate from the historical source review above.
The final source was independently reviewed by a fresh verifier and Herdr Fable 5.2.

| Check | Recorded outcome |
| --- | --- |
| MCP initialize and tool listing | Connected; 17 upstream tools listed |
| Static page via HTTP | HTTP 200 and nonempty selected evidence |
| JavaScript-rendered page | Browser extraction returned usable evidence |
| Current-page extraction and session cleanup | Passed; closed test session absent from listing |
| Shared launcher from repository and another directory | Bounded sourced JSON; independent of caller cwd |
| Native Claude foreground delegation | Completed report; no permission denials; no parent Scrapling tools |
| Codex and Copilot calling the shared command | Successful sourced reports; no parent Scrapling MCP registration |
| Final package tests | 41 passed: 19 installer, 21 launcher, one source-move integration test |
| Existing repository checks | kb-wiki 129 passed; cove 42 passed; TypeScript noEmit passed |
| Skill, source format and independent reviews | Passed; final Fable re-review PASS |
| Actual User Level rerun and ownership parity | Idempotent; ready/browser state, hashes, links and owned copy checked |

Static and JavaScript fixtures were `https://quotes.toscrape.com/` and its `/js/` page.
The worker also read both originally requested Scrapling AI documentation pages. These
checks establish compatibility for the tested route and fixtures, not a broad accuracy
score, anti-bot guarantee or controlled speed comparison. The complete observed commands
and scope are in the [review-fixes record](../superpowers/plans/2026-11-15-scrapling-review-fixes.md).

### Remaining boundaries

- Live validation covered macOS arm64; Linux browser system dependencies remain unverified.
- The latency/token/precision-recall evaluation in section 10 has not been performed.
  Targeted extraction and reuse are plausible efficiency mechanisms, not measured savings.
- MCP tools retain broader network/browser capabilities. Read-only behavior is an instruction
  policy, not a server-side network allowlist or a security sandbox. Page content remains untrusted.
- Process-group cleanup cannot supervise descendants that deliberately create another session,
  and cannot handle SIGKILL. Browser session closure and appropriate outer supervision still matter.
- The shipped package uses local stdio. Remote HTTP, Docker deployment, deterministic Python
  crawlers, adaptive recovery and a shared cross-client response cache remain separate alternatives
  or future work; this delivery does not implement them.
