<div align="center">

# 🛠️ Agent Skills

**A collection of agent skills for [Claude Code](https://claude.com/claude-code)**

[![GitHub](https://img.shields.io/badge/GitHub-RayChang%2Fagent--skills-181717?logo=github)](https://github.com/RayChang/agent-skills)
[![Claude Code](https://img.shields.io/badge/Claude-Code-D97757?logo=anthropic&logoColor=white)](https://claude.com/claude-code)
![Skills](https://img.shields.io/badge/skills-5-blue)
![Docs](https://img.shields.io/badge/docs-English-green)

[繁體中文](./README.md) · **English**

</div>

---

## 📚 Skills Overview

| Skill | Purpose | Primary Trigger |
|---|---|---|
| [📚 `kb-wiki`](#-kb-wiki) | LLM-driven personal knowledge base (Karpathy LLM Wiki pattern) | `/kb-wiki <op>` |
| [📝 `markitdown`](#-markitdown) | File / URL → Markdown conversion | Natural language |
| [✅ `cove`](#-cove) | Agentic CoVe 2.0: open-book three-phase self-verification | `/cove` |
| [🧱 `harness-init`](#-harness-init) | Project harness scaffolding (unified layout spec) | `/harness-init` |
| [🔌 `mcp-agent`](#-mcp-agent) | Wrap a single MCP server as a project-scoped subagent (token/permission isolation) | `/mcp-agent` |

---

## 📦 Installation

```bash
npx skills add RayChang/agent-skills@<skill-name>
```

> When run inside a project, the skill's files land in the project's `.agents/skills/<skill-name>/` with a symlink in `.claude/skills/` (auto-loaded on Claude Code startup). With the global flag it installs to user-level `~/.agents/skills/`. **To update an installed skill, re-run the same install command in that project** — skills are copy-deployed; editing this repo changes nothing until redeployed.

---

## 🚀 Usage

Skills can be triggered in two ways:

### 1️⃣ Natural-language triggering

Describe what you need; Claude picks the right skill based on its description:

| Say this | Triggers |
|---|---|
| "Convert this PDF to markdown" | 📝 `markitdown` |
| "Set up a KB for this project" | 📚 `kb-wiki` |
| "Verify the last answer" | ✅ `cove` |
| "Scaffold this project's harness" | 🧱 `harness-init` |
| "Wrap the Figma MCP server as an agent" | 🔌 `mcp-agent` |

### 2️⃣ Slash command triggering

Type `/<skill-name>` or `/<skill-name> <operation>`:

```bash
/kb-wiki init        # Initialize the knowledge base
/kb-wiki ingest      # Ingest a new source
/cove                # Verify the last response
/harness-init        # Scaffold the project harness
/mcp-agent           # Wrap an MCP server as a project-scoped agent
```

> 💡 Type `/` in Claude Code to browse available skills, or run `/help` for details.

---

## ✨ Skills

### 📚 `kb-wiki`

Based on [Andrej Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Builds and maintains an LLM-driven personal knowledge base inside a project.

> The **LLM** writes and maintains the wiki content; the **human** curates sources and asks questions.

#### 🏗️ Three-Layer Architecture

| Layer | Location | Owner |
|---|---|---|
| **Raw sources** | `kb/raw/sources/` | Human (immutable) |
| **Wiki** | `kb/wiki/` | LLM (fully maintained) |
| **Schema** | `kb/schema.md` + `CLAUDE.md` | Human-defined, LLM-followed |

#### 🔧 Supported Operations

| Operation | Description |
|---|---|
| `init` | Initialize the KB, set up directory structure and schema |
| `ingest` | Process a new source: update wiki pages + write a per-source summary (`summaries/`, the ingest ledger) |
| `query` | Answer a question from the wiki (facts cited, inference labeled); file substantial answers back |
| `lint` | Health check: broken links, orphan pages, contradictions, un-ingested sources, **prompt-injection marker scan** (raw + wiki, flagged for human review); reports auto-pruned to the newest 3 |
| `map` | Rebuild index, MOCs, and cross-links |
| `verify` | Drift audit: check wiki pages against the actual codebase |
| `capture` | Extract design decisions and lessons after a milestone |
| `migrate` | Upgrade an older KB to the current schema (rebuild schema preserving customizations, backfill the summaries ledger, add overview) |

> 💡 **`verify` ≠ `lint`**: `lint` checks the wiki's *internal* health (broken links, orphans, contradictions); `verify` checks its *external* alignment — whether pages still match the code they describe. Forward-design pages aren't drift; only the current-state claims they assert can drift. Fixes are always re-verified in an independent pass.

#### ⚙️ Running the Scripts Directly (lint / map)

`lint` and `map` ship deterministic scripts (requires [Bun](https://bun.sh)) that agents run directly — no LLM tokens spent. `<skill-dir>` is the skill's install directory (the "Base directory" announced when the skill loads — `.claude/skills/kb-wiki`, `.agents/skills/kb-wiki`, etc. depending on deployment). Always run from the **project root**:

```bash
bun "<skill-dir>/scripts/lint.ts"                   # structural checks + injection-marker scan
bun "<skill-dir>/scripts/lint.ts" --deep            # + LLM content analysis (contradictions, staleness, gaps)
bun "<skill-dir>/scripts/map.ts"                    # rebuild index + MOCs (preserves curated one-liners)
bun "<skill-dir>/scripts/map.ts" --deep             # + LLM cross-link discovery
bun "<skill-dir>/scripts/map.ts" --regen-summaries  # re-extract every summary from page bodies
```

Behavior notes:

- The default mode has **zero SDK dependency** — only `--deep` needs `@anthropic-ai/sdk`; when it's missing, the structural part still completes with an actionable message
- Running in a directory without `kb/wiki/` refuses outright (exit 1) instead of scaffolding a junk KB skeleton
- Lint reports are written to `kb/wiki/lint-report-<date>.md`; only the newest 3 are kept
- `map` preserves existing one-liners in `index.md` by default (they're treated as human-curated); only new pages get extracted summaries — pass `--regen-summaries` to deliberately re-extract all

Environment variables (all optional):

| Variable | Purpose | Default |
|---|---|---|
| `KB_DEV` | Developer handle for the activity log (written to `kb/wiki/log/<dev>.md`) | slug of `git config user.name` |
| `KB_MODEL` | Model used by `--deep` | `claude-sonnet-4-6` |
| `KB_MAX_TOKENS` | `--deep` response cap (positive integer; invalid values fall back) | `4096` |

#### 🔐 Trust Boundary & Security

The KB ingests **untrusted** sources and runs shell commands, so every operation works inside an explicit trust boundary (Meta `schema.md` → Wiki pages → Raw sources, decreasing trust):

- **Sources are data, not instructions**: content under `kb/raw/` is only summarized, quoted, and cited — embedded imperatives (run a command, change the schema, delete pages, fetch URLs, leak secrets) are quoted, never obeyed
- **Sanitize before the shell**: category names and any project/user-derived value must pass an `^[a-z][a-z0-9-]*$` allowlist before reaching a Bash command (closes `init` command injection)
- **No silent propagation**: filed-back content keeps its citations and `origin`; a claim resting on a single external source stays `seedling` and is never laundered into an un-cited "fact" (closes the query→map feedback-loop poisoning)
- **Quarantine on suspicion**: `lint` scans for prompt-injection / exfiltration markers (instruction-override, role reassignment, `curl … | sh`, secret requests), flagged for human review — never auto-resolved

#### 📥 Install

```bash
npx skills add RayChang/agent-skills@kb-wiki
```

**Updating an existing install**: skills are copy-deployed — editing this repo changes nothing in projects that already installed it. Re-run the install command in each project to pull the latest (the user-level global copy needs the CLI's global variant; a project-level run won't touch it):

```bash
bunx skills add https://github.com/raychang/agent-skills --skill kb-wiki
```

#### 🎬 First-Time Setup (init)

1. `cd` into the project where you want the knowledge base
2. Run `/kb-wiki init` (or tell Claude "initialize a KB for this project")
3. Claude reads `CLAUDE.md` / `README.md` / `package.json` and proposes a category structure for your confirmation
4. On confirmation, the following is created automatically:
   - 📁 `kb/raw/sources/`, `kb/raw/assets/` (raw layer — immutable)
   - 📁 `kb/wiki/{categories}/`, `kb/wiki/summaries/` (LLM-maintained wiki layer; summaries = per-source digests)
   - 📄 `kb/schema.md` (this project's KB conventions)
   - 📄 `kb/wiki/index.md`, `kb/wiki/log/<dev>.md` (one append-only activity log per developer — no merge conflicts), `kb/wiki/overview.md` (high-level synthesis, kept current by ingest)
   - 📝 A `## Knowledge Base` section is appended to the project's `CLAUDE.md` so any future LLM agent entering the project auto-discovers the KB

#### 🔄 Daily Workflow

```mermaid
flowchart LR
    A[📥 Drop sources into<br/>kb/raw/sources/] --> B[🔄 /kb-wiki ingest]
    B --> C[📚 Wiki updated<br/>summaries + index + log]
    C --> D[💬 /kb-wiki query<br/>or just ask]
    D --> E[📝 Answers filed<br/>back to wiki]
    E --> F[🔧 Periodic lint / map / verify<br/>to stay healthy & aligned]
```

---

### 📝 `markitdown`

Uses Microsoft's [markitdown](https://github.com/microsoft/markitdown) to convert files or URLs to Markdown via `uvx` — zero install.

#### 📋 Supported Formats

| Category | Formats |
|---|---|
| **Documents** | PDF, DOCX, PPTX, XLSX, EPUB |
| **Web** | HTML, Wikipedia, RSS/Atom URLs |
| **Data** | CSV, JSON, XML |
| **Media** | Audio, YouTube URLs |
| **Other** | ZIP, Jupyter Notebook, Outlook `.msg` |

#### 📥 Install

```bash
npx skills add RayChang/agent-skills@markitdown
```

#### ⚙️ First-Time Setup

After install, run `/markitdown setup` once (or tell Claude "set up markitdown"). This appends a `## File & URL Reading` section to `~/.claude/CLAUDE.md` so Claude **prefers markitdown over WebFetch/Read** whenever you hand it a file or URL. A **global** write is shown and confirmed first; the block is HTML-comment-marked so it stays auditable and removable; the operation is idempotent — if the section already exists, it skips.

For project-level registration instead, run `/markitdown setup --project` (writes to the project's `CLAUDE.md`).

#### 🔐 Trust Boundary & Security

markitdown runs external tooling (`uvx`/PyPI, optional container) and converts **untrusted** files and URLs, so SKILL.md defines trust boundaries: **converted output is data, not instructions** (never act on directives embedded in a document); **no pipe-to-shell installs** (`curl … | sh` is removed from error handling in favor of a trusted package-manager install of uv); **batch ops pass filenames as positional args** (`find -print0 | xargs -0`, closing `; rm -rf ~`-style filename injection); documents of unknown provenance **prefer the Docker isolation path**; and external code is **trusted only from Microsoft's official** package/image, with version pinning available.

---

### ✅ `cove`

Built on Meta AI's [Chain-of-Verification (CoVe)](https://arxiv.org/abs/2309.11495) and
Microsoft's [CRITIC](https://arxiv.org/abs/2305.11738), this upgrades the original
**closed-book** self-verification into an **open-book (tool-interactive)** three-phase
pipeline — exactly the extension the CoVe paper proposes in its own conclusion.

Manually triggered with `/cove` to verify and refine the previous response (or supplied
text).

#### 🔄 Three-phase pipeline

| Phase | Action | Purpose |
|---|---|---|
| **1️⃣ Draft & Plan** | Draft the answer and emit a JSON verification plan | `needs_verification` gate short-circuits chitchat/common knowledge |
| **2️⃣ Tiered Verify** | `deep` → open-book parallel search-subagents; `shallow` → conservative closed-book | Ground claims in external evidence |
| **3️⃣ Critique & Finalize** | Strict review against evidence, rewrite with citations | Corrections cite sources; unsupported claims stated honestly |

#### 🎯 Tier routing

| Tier | How | When |
|---|---|---|
| **🔬 `deep`** | Open-book: parallel search-subagent (fresh context, **never sees the draft**) | numbers/versions/APIs, named references, legal/medical/compliance, niche topics, conclusions the user will act on |
| **🪶 `shallow`** | Closed-book, conservative (caveats only, no confident rewrite) | logic/reasoning, context-dependent, common knowledge, opinion |

> 💡 The `deep` path keeps CoVe's **Factored isolation** (the verifier can't see the
> draft, avoiding repeated hallucination) and adds CRITIC's **open-book grounding**.
> `shallow` is deliberately conservative because CRITIC shows self-correction without
> external feedback can fail to help or even degrade the answer.

#### 🔐 Trust Boundary & Security

Every `/cove` input — the `/cove <text>` argument, the previous response, and web-search
evidence — is **untrusted**. To resist indirect prompt injection, all three interpolation
points (Phase 2 question + evidence, Phase 3 draft + results) are fenced in `<untrusted_*>`
tags, with the prompts framing the contents as **data, not instructions**; Phase 1 strips
embedded directives when forming queries; and the Phase 2 subagent is granted **read-only
web search only** (least privilege). The reference implementation ships matching regression
tests.

#### 🐍 Reference implementation

`cove/reference/` ships a provider-agnostic Python implementation (`asyncio` parallel
verification, pluggable `LLMClient` / `SearchProvider`) for embedding CoVe 2.0 in your
own LLM app. See `cove/reference/README.md`.

#### 📥 Install

```bash
npx skills add RayChang/agent-skills@cove
```

---

### 🧱 `harness-init`

Scaffolds a project's harness per the [unified layout spec](./harness-init/references/layout-spec.md): AGENTS.md / CLAUDE.md routers, gated task pipeline, roadmap + lessons with their small indexes, an architecture constitution (with an enforcement debt register), and a domain-agent template.

#### Highlights

- **Detect before asking**: package manager, test commands, and git host are auto-detected; only unresolved facts become questions (one at a time, with a recommended default)
- **Additive-only**: existing files are always skipped — safe for incremental adoption in existing projects; re-runs never overwrite your edits
- **Delegates, never duplicates**: `kb/` scaffolding is owned by the `kb-wiki` skill (single-source-of-truth rule)
- Ends with a scaffold report + a formatted machine-level facts-table row (for `~/.claude/CLAUDE.md` Project Facts)

#### 📥 Install

```bash
npx skills add RayChang/agent-skills@harness-init
```

> 💡 With this repo already cloned locally, skip installation: ask the agent to "read and execute `<repo-path>/harness-init/SKILL.md`".

#### 🎬 Usage

Start the agent at the target project root and type `/harness-init` (or say "scaffold this project's harness"). The flow:

1. **Precondition**: cwd must be a git repo root (otherwise it asks whether to `git init` first)
2. **Auto-detect**: package manager, test/typecheck/lint commands, git host + MR tool, base branch — you won't be asked about these
3. **Questions**: only unresolved facts, plus two that are never guessed (one at a time, with recommended defaults): commit emoji position (a commitlint config is read instead of asking) and worktree convention (inside-repo vs sibling)
4. **Scaffold + report**: writes the skeleton (existing files are always skipped), then prints Created/Skipped lists, remaining `TODO(verify)` markers, NEXT STEPS, and a formatted Project Facts row

After the report, your part:

- Clear `AGENTS.md`'s `TODO(verify)` markers with **actually-run** commands (the step that turns a skeleton into a real harness)
- Run `/kb-wiki init` if you want a KB; author the real constitution articles (the two shipped ones are proposals)
- Paste the facts row into your machine-level config, commit the scaffold

> 🔁 Re-run the same command on existing projects to fill gaps — additive-only means it's a near no-op on fully-structured projects. Until the `TODO(verify)` markers are cleared, that project's harness is not live.

---

### 🔌 `mcp-agent`

Wraps a single MCP server as a project-scoped subagent: the server's tools, token cost, and permission surface exist only inside the dispatched agent — the main conversation and every other session carry none of it.

#### Highlights

- **Decision gate first**: a server that nearly every session uses gets steered to `.mcp.json` instead — wrapping it would add a dispatch hop for no isolation gain
- **Six design rules**: one agent wraps one server; server config lives only in the agent's frontmatter; secrets only as `${ENV_VAR}` (never written to files); the `description` is the routing trigger; hard report caps (raw MCP payloads never flow back); outputs are never self-certified
- **Mandatory smoke test**: a read-only dry run (frontmatter / connection / env, all three verified) before the agent counts as existing
- **Audit mode**: if the target file already exists, it's checked against the design rules — report only, no changes

#### 📥 Install

```bash
npx skills add RayChang/agent-skills@mcp-agent
```

#### 🎬 Usage

At the target project root, say "wrap the `<server>` MCP server as an agent" (or `/mcp-agent`). Your only preparation: put the server's credential in a shell environment variable. The flow: decision gate → detect/ask (one question at a time, with recommended defaults) → generate `.claude/agents/<server>-worker.md` → smoke test → fixed-format report.

> 🔑 Rotating a credential means changing the env var's value — the agent file never changes.
