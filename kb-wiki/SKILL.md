---
name: kb-wiki
description: This skill should be used when working with a project knowledge base that follows the Karpathy LLM Wiki pattern. It provides workflows for ingesting source documents, querying the KB, running health checks (lint), verifying the wiki against the actual codebase (drift audit), capturing design decisions and lessons learned, and initializing a new KB in a project. Trigger when the user mentions the KB, asks to ingest a source, run a query against the wiki, check whether the KB has drifted from the code, capture learnings, or set up a knowledge base.
---

# KB Wiki Skill

A methodology for LLM-maintained knowledge bases based on Andrej Karpathy's LLM Wiki pattern. LLMs maintain the wiki; humans curate sources and ask questions.

**Schema reference**: Load `references/schema.md` for page format, link conventions, directory structure, and log format details.

**New project assets**: `assets/schema.md` is a template — copy to `kb/schema.md` with project name and categories substituted when initializing.

---

## Guard: check KB exists before any operation

Before running Ingest, Query, Lint, Map, Verify, or Capture — check whether `kb/wiki/index.md` exists. If it does not, stop and tell the user:

> "這個專案還沒有 KB。先執行 `/kb-wiki init` 初始化。"

Do not attempt to proceed with the operation.

---

## Operations

### Init — Set up KB in a new project

To initialize a KB when a project has none:

1. Read the project context to understand its domain: check `CLAUDE.md`, `README.md`, `package.json`, or any obvious top-level files. Based on what the project is, propose a category structure that fits. For example:
   - A backend API project might need: `concepts`, `api`, `integrations`, `patterns`, `lessons`
   - A data pipeline project might need: `concepts`, `data-sources`, `transforms`, `infrastructure`, `lessons`
   - A product with competitors might need: `concepts`, `integrations`, `competitors`, `patterns`, `lessons`
   Present the proposed categories with a one-line rationale for each, then ask: "這樣的分類結構合適嗎？有要調整的嗎？"
   Wait for confirmation. Adjust if the user requests changes; proceed with proposed categories if they say nothing.
2. Use the Bash tool to create the directory structure:
   ```bash
   mkdir -p kb/raw/sources kb/raw/assets kb/wiki/{category1} kb/wiki/{category2} ...
   ```
   Expand the confirmed category list into the command before running.
3. Copy `assets/schema.md` from this skill to `kb/schema.md`. Replace:
   - `{{PROJECT_NAME}}` → actual project name
   - The category list in the Architecture section → the confirmed categories
4. Create `kb/wiki/index.md`:
   ```markdown
   # {Project} Wiki — Index

   > Auto-maintained. Last updated: YYYY-MM-DD

   ---

   **Total: 0 pages**
   ```
5. Create `kb/wiki/log.md`:
   ```markdown
   # {Project} Wiki — Log

   > Append-only chronological record. Newest entries at top.

   ---
   ```
6. Register the KB in the project's agent config so any LLM entering the project auto-discovers it:
   - Identify the primary agent config file in the project root: `GEMINI.md` (for Gemini CLI), `CLAUDE.md` (for Claude Code), or `AGENTS.md`.
   - If none exist, create the standard one for the current platform (e.g., `GEMINI.md` if running in Gemini CLI, `CLAUDE.md` for Claude Code).
   - Append the section below to the target file — **skip if it already contains a `## Knowledge Base` heading** (idempotent):
     ```markdown

     ## Knowledge Base

     This project maintains a knowledge base under `kb/`. Conventions, page format, and workflows (ingest / query / lint / map / capture) are defined in `kb/schema.md`. Read it before any KB operation.
     ```
7. Tell the user: KB initialized with categories: {list}. Schema registered in {Target Config File}. Drop source documents into `kb/raw/sources/` and run `/kb-wiki ingest`.

---

### Ingest — Process a new source document

To ingest a source from `kb/raw/sources/`:

1. Read `kb/wiki/index.md` to understand existing wiki content and discover what categories exist
2. Read the source document fully
3. Identify which existing wiki pages it relates to, and what new pages are needed
4. **Duplicate check**: before creating a new page, scan existing page titles and tags for near-matches (aliases, alternate spellings, abbreviations). If a concept already has a page under a different name, update the existing page instead of creating a duplicate. When in doubt, ask the user.
5. Create new pages and/or update existing pages — a single source can touch multiple pages. New pages default to `status: seedling`.
5. Update `kb/wiki/index.md`: add new pages, update one-line summaries if changed
6. Append to `kb/wiki/log.md`:
   ```
   ## [YYYY-MM-DD] ingest | Processed N source(s)
   - Sources: filename(s)
   - Pages created: [[page1]]
   - Pages updated: [[page2]]
   - Key findings: (1) finding one; (2) finding two
   ```

**Never modify files under `kb/raw/`.**

---

### Query — Answer a question using the KB

To answer a question using KB content:

1. Read `kb/wiki/index.md` to identify relevant pages
2. Read the relevant wiki pages
3. Synthesize the answer with page citations (e.g. `→ [[patterns/error-triage]]`)
4. **File substantial answers back into the wiki** — create a new page or enrich an existing one. Queries should compound the KB, not disappear into chat history. Only skip filing if the answer is trivial or entirely covered by existing pages.
5. Append to `kb/wiki/log.md`:
   ```
   ## [YYYY-MM-DD] query | {question summary}
   - Pages consulted: [[page1]], [[page2]]
   - Pages created/updated: [[page]] (if filed back)
   ```

---

### Lint — Run a health check on the wiki

Use the Bash tool to run the script directly (deterministic, no extra tokens):
```bash
bun ~/.claude/skills/kb-wiki/scripts/lint.ts           # structural checks
bun ~/.claude/skills/kb-wiki/scripts/lint.ts --deep    # + LLM content analysis
```

If Bun is unavailable (command not found), fall back to doing it manually:

1. Read all pages in `kb/wiki/`
2. Check for:
   - **Broken links**: `[[page]]` references that don't have a corresponding file
   - **Orphan pages**: pages with no inbound links from other pages
   - **Contradictions**: conflicting claims across pages
   - **Missing pages**: concepts frequently mentioned but without a dedicated page
   - **Stale content**: information likely superseded by newer sources
   - **New article candidates**: interesting connections between existing pages that warrant a synthesis page
   - **Source gaps**: topics in the wiki that lack a raw source — suggest new documents to ingest
3. Report findings grouped by severity (error / warning / info)
4. Fix broken links and orphan pages immediately; flag contradictions and stale content for human review
5. Append to `kb/wiki/log.md`:
   ```
   ## [YYYY-MM-DD] lint | Health check: N errors, N warnings, N info
   - Mode: structural
   - Pages scanned: N
   - Issues found: N
   ```

---

### Verify — Check the wiki against the actual codebase (drift audit)

Lint checks the wiki's *internal* health (broken links, orphans, contradictions). Verify checks its *external* alignment — whether pages still match the code they describe. Run periodically and before relying on the KB for a decision.

**1. Classify every page first — this is the step naive audits skip:**

| Page kind | Describes | Action |
|---|---|---|
| **code-verifiable** | in-repo implementation: file paths, import aliases, token/symbol names, signatures, config values, CLI commands, dependency versions, module-boundary tags | verify against code |
| **forward-design** | a not-yet-built design / future intent | do NOT flag prescriptions as drift; only verify any "current state / 現況" snapshot it asserts |
| **external / decision** | rejected options, third-party tool capabilities, competitor notes, historical decisions | out of scope — skip (no in-repo target to drift against) |

State which pages you skipped and why. Discover the set from `kb/wiki/index.md` + the directory structure; never assume.

**2. Extract concrete claims** from each code-verifiable page: every path, `@alias/*`, token/symbol name, function signature, config key, command, version, tag.

**3. Verify each claim against the real files.** Open the actual source, config (tsconfig / build config / package manifest), and module-boundary tags — do NOT eyeball or trust the page. Cite `file:line` for every verdict.

**4. Assign a verdict per claim:**

| Verdict | Meaning |
|---|---|
| ✅ match | KB matches code |
| ⚠️ DRIFT | KB says X, code says Y — quote both + `file:line` |
| 🅿️ not-yet-built | forward-design prescription; **not** drift |
| ❓ unverifiable | cannot confirm from the repo (say why) |

**5. Scale with parallel subagents** for a large KB — partition pages into groups, one subagent per group, each returning a drift table with `file:line` evidence. **REQUIRED SUB-SKILL** for the fan-out: superpowers:dispatching-parallel-agents.

**6. Fix, then INDEPENDENTLY re-verify.** After correcting drifted pages, run a second verification pass — ideally a fresh subagent told NOT to assume your fixes are right — over the edited pages. Bump each fixed page's `updated` date and add a one-line drift-correction note at the top.

**7. Append to `kb/wiki/log.md`:**
```
## [YYYY-MM-DD] verify | Drift audit: N pages checked, M drifts fixed
- Scope: code-verifiable pages (skipped: <external/forward-design pages + why>)
- Drifts fixed: [[page]] — was X, now Y
- Re-verified: clean / remaining ⚠️: ...
```

**Close two loopholes:**
- **Forward-design ≠ drift.** Do not report a forward-design page as drift just because the thing it describes "doesn't exist yet." If the page honestly states future intent and asserts no false current-state, it is 🅿️, not ⚠️. Conversely, a forward-design page's concrete "現況" snapshot (e.g. "lib X is empty", "Y is not installed") CAN drift and must be checked.
- **Structure sketch ≠ precise path claim.** A high-level directory/structure diagram may use conventional shorthand (e.g. omitting an NX `src/lib/` segment, eliding `node_modules`). Flag a path ⚠️ only if it points to the **wrong** lib/dir or a non-existent location — not merely because a conceptual sketch is abbreviated. Hold "the symbol lives exactly at `<path>`" claims to the exact path; judge structure overviews by whether they'd mislead, not by literal completeness.

---

### Map — Rebuild index, MOCs, and cross-links

Use the Bash tool to run the script directly (deterministic, no extra tokens):
```bash
bun ~/.claude/skills/kb-wiki/scripts/map.ts           # rebuild index + MOCs
bun ~/.claude/skills/kb-wiki/scripts/map.ts --deep    # + LLM cross-link discovery
```

If Bun is unavailable (command not found), fall back to doing it manually:

1. Read all pages in `kb/wiki/` (excluding `log.md`, `_moc.md` files, and `summaries/`)
2. Discover existing categories from the directory structure — do not assume fixed category names
3. Rebuild `kb/wiki/index.md`:
   ```markdown
   # {Project} Wiki — Index

   > Auto-maintained by `kb:map`. Last updated: YYYY-MM-DD

   ---

   ## {Category} (N)
   - [[category/page-name]] — one-line summary

   ...

   ---
   **Total: N pages**
   ```
   Sort pages alphabetically within each category. Write accurate one-line summaries by reading each page — do not copy old summaries blindly.
4. For each category, create/update `kb/wiki/{category}/_moc.md`:
   ```markdown
   # {Category} — Map of Content

   > Auto-maintained by `kb:map`. Last updated: YYYY-MM-DD

   ## [[category/page|Title]]
   Summary paragraph.
   Tags: `tag1`, `tag2`
   Links to: [[other-page]]
   ```
5. Find page pairs that should reference each other but don't (share 2+ tags, discuss same concept from different angles, or one mentions a concept the other is about). Add missing links to "See Also" sections.
6. Report stats and append to `kb/wiki/log.md`:
   ```
   ## [YYYY-MM-DD] map | Rebuilt index + N MOCs
   - Pages indexed: N
   - Total links: N
   - Orphan pages: N
   ```

---

### Capture — Extract learnings after a phase or milestone

To capture learnings at the end of a significant implementation block:

1. Ask the user (if interactive): "這個階段有幾個值得存進 wiki 的設計決策或教訓，要我整理進去嗎？"
2. Extract from the completed work and write to the most appropriate category/page for this project:
   - **Design decisions with rationale** — prefer an existing `lessons/design-decisions.md` if present, otherwise the closest equivalent
   - **Pitfalls and workarounds** — create a new page in `lessons/` if the topic is distinct
   - **Reusable patterns** — write to `patterns/` or equivalent category
3. Update `kb/wiki/index.md` and append to `kb/wiki/log.md`

**Do not capture**: implementation progress, code already in the codebase, ephemeral state.

---

## Invariants

- **Never write to `kb/raw/`** — it is immutable source material
- **Always update `index.md` and `log.md`** after any wiki change
- **Link liberally** — cross-references between pages are what give the wiki its value
- **Keep index.md summaries accurate and specific** — at ~100 pages / hundreds of thousands of words, a well-maintained index is what makes direct LLM reads sufficient; RAG is not needed at this scale. As the wiki grows beyond this, introduce search tools (e.g. qmd) as a scaling complement — not a replacement for the index.
- **File outputs back** — query answers are wiki contributions, not disposable chat responses
- **Never assume categories** — always discover them from the actual directory structure or ask during init
- **LLM owns content, human owns meta** — the LLM writes and maintains all wiki content pages; the human owns schema.md, category structure, and high-level decisions. Do not modify schema without human approval.
- **Contradictions require human judgment** — when Lint finds conflicting claims across pages, flag them for human review with both sides cited. Do not silently resolve contradictions by picking one side.
- **Verify ≠ Lint** — Lint is internal wiki health; Verify is alignment with the code. Forward-design pages are not drift; only the current-state claims they assert can drift. Always re-verify fixes independently.
