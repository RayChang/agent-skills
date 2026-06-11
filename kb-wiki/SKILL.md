---
name: kb-wiki
description: This skill should be used when working with a project knowledge base that follows the Karpathy LLM Wiki pattern. It provides workflows for ingesting source documents, querying the KB, running health checks (lint), verifying the wiki against the actual codebase (drift audit), capturing design decisions and lessons learned, and initializing a new KB in a project. Trigger when the user mentions the KB, asks to ingest a source, run a query against the wiki, check whether the KB has drifted from the code, capture learnings, or set up a knowledge base.
---

# KB Wiki Skill

A methodology for LLM-maintained knowledge bases based on Andrej Karpathy's LLM Wiki pattern ([idea file](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) and the companion ["LLM Knowledge Bases" X post](https://x.com/karpathy/status/2039805659525644595)). LLMs maintain the wiki; humans curate sources and ask questions.

The wiki is a **persistent, compounding artifact** — each source is compiled once into interlinked pages and kept current, instead of being re-retrieved and re-synthesized on every question (the RAG failure mode). The index plus brief per-source summaries are the retrieval backbone that makes direct LLM reads sufficient at ~100-page scale.

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
   mkdir -p kb/raw/sources kb/raw/assets kb/wiki/summaries kb/wiki/{category1} kb/wiki/{category2} ...
   ```
   Expand the confirmed category list into the command before running. `summaries/` is not a category — it holds per-source summaries written during Ingest.
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
6. Create `kb/wiki/overview.md` — a stub for the high-level synthesis (referenced by the schema; Ingest keeps it current):
   ```markdown
   ---
   title: Overview
   category: root
   tags: [overview, synthesis]
   status: seedling
   created: YYYY-MM-DD
   updated: YYYY-MM-DD
   ---

   # {Project} — Overview

   > High-level synthesis of the KB. Updated during Ingest when a new source shifts the big picture.

   No synthesis yet — populated as sources are ingested.
   ```
7. Register the KB in the project's agent config so any LLM entering the project auto-discovers it:
   - Identify the primary agent config file in the project root: `GEMINI.md` (for Gemini CLI), `CLAUDE.md` (for Claude Code), or `AGENTS.md`.
   - If none exist, create the standard one for the current platform (e.g., `GEMINI.md` if running in Gemini CLI, `CLAUDE.md` for Claude Code).
   - Append the section below to the target file — **skip if it already contains a `## Knowledge Base` heading** (idempotent):
     ```markdown

     ## Knowledge Base

     This project maintains a knowledge base under `kb/`. Conventions, page format, and workflows (ingest / query / lint / map / capture) are defined in `kb/schema.md`. Read it before any KB operation.
     ```
8. Tell the user: KB initialized with categories: {list}. Schema registered in {Target Config File}. Drop source documents into `kb/raw/sources/` and run `/kb-wiki ingest`.

---

### Ingest — Process a new source document

To ingest a source from `kb/raw/sources/`:

1. Read `kb/wiki/index.md` to understand existing wiki content and discover what categories exist. Compare `kb/raw/sources/` against `summaries/` to see which sources are still pending — this drives the pacing rule below
2. If the source is not markdown (PDF, EPUB, DOCX, …), convert it to markdown first (e.g. with the markitdown skill) and save the conversion as a **new** file alongside the original in `kb/raw/sources/` — never alter the original
3. Read the source document fully
4. Identify which existing wiki pages it relates to, and what new pages are needed
5. **Duplicate check**: before creating a new page, scan existing page titles and tags for near-matches (aliases, alternate spellings, abbreviations). If a concept already has a page under a different name, update the existing page instead of creating a duplicate. When in doubt, ask the user.
6. **Concept threshold**: a concept this source mentions only in passing does not get a standalone page yet — record it in the source summary's Key Terms (step 8) or the closest related page, and promote it to its own page once a second source or query touches it. Concepts central to the project are exempt: create them immediately.
7. Create new pages and/or update existing pages — a single source can touch multiple pages. New pages default to `status: seedling`.
8. **Write a per-source summary** at `kb/wiki/summaries/{source-slug}.md` — the ingest ledger and retrieval backbone. Keep it brief: frontmatter (`source`, optional `origin: external | self`, `ingested` date, `tags`), 3–6 key-takeaway bullets, Key Terms, and links to every page touched. Format in `references/schema.md`.
9. Update `kb/wiki/overview.md` only if the new source shifts the big picture (new thesis, changed architecture, overturned assumption) — not for routine additions
10. Update `kb/wiki/index.md`: add new pages, update one-line summaries if changed, and list the new summary in the Sources section (create the section on first ingest — format in `references/schema.md`)
11. Append to `kb/wiki/log.md`:
   ```
   ## [YYYY-MM-DD] ingest | Processed N source(s)
   - Sources: filename(s)
   - Pages created: [[page1]]
   - Pages updated: [[page2]]
   - Key findings: (1) finding one; (2) finding two
   ```

**Pacing**: default to ingesting one source at a time and report key findings as you go — the human stays in the loop. If more than ~10 sources are pending, say so and process them in batches of 5–10.

**Never modify or delete existing files under `kb/raw/` — the only allowed addition is the markdown conversion from step 2.**

---

### Query — Answer a question using the KB

To answer a question using KB content:

1. Read `kb/wiki/index.md` to identify relevant pages
2. Read the relevant wiki pages
3. Synthesize the answer with page citations (e.g. `→ [[patterns/error-triage]]`). Match the output form to the question — prose for simple answers, a comparison table for trade-off questions, a standalone report page for deep analyses
4. **Separate fact from inference**: claims backed by wiki pages or raw sources carry citations; your own inference is labeled explicitly (e.g. 「推論」). Open questions stay marked open — never silently resolve uncertainty when filing back
5. **File substantial answers back into the wiki** — create a new page or enrich an existing one. Queries should compound the KB, not disappear into chat history. Only skip filing if the answer is trivial or entirely covered by existing pages.
6. Append to `kb/wiki/log.md`:
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

1. Read all pages in `kb/wiki/` and list the files in `kb/raw/sources/`
2. Check for:
   - **Broken links**: `[[page]]` references that don't have a corresponding file
   - **Orphan pages**: pages with no inbound links from other pages
   - **Missing frontmatter**: content pages lacking YAML frontmatter or its required fields (`title`, `category`, `tags`) — `summaries/` pages use their own frontmatter and are exempt
   - **Empty categories**: category directories with no pages
   - **Un-ingested sources**: files in `kb/raw/sources/` with no corresponding `summaries/` page and no page citing them — the KB is silently lagging its sources
   - **Contradictions**: conflicting claims across pages
   - **Missing pages**: concepts frequently mentioned but without a dedicated page
   - **Stale content**: information likely superseded by newer sources
   - **New article candidates**: interesting connections between existing pages that warrant a synthesis page
   - **Source gaps**: topics in the wiki that lack a raw source — suggest new documents to ingest, and note gaps a quick web search could fill
   - **Next questions**: 2–3 follow-up questions worth investigating — the wiki's growth direction
3. Report findings grouped by severity (error / warning / info). If a previous lint report exists, note the trend: issues new since last time vs resolved
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

   ## Sources (N)
   - [[summaries/source-slug]] — one-line takeaway

   ---
   **Total: N pages**
   ```
   Sort pages alphabetically within each category. Write accurate one-line summaries by reading each page — do not copy old summaries blindly. Summaries appear only in the Sources section — they get no MOC and do not count toward the page total.
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

- **Never modify or delete anything under `kb/raw/`** — it is immutable source material. The one allowed addition: saving a markdown conversion of a non-markdown source as a new file next to the original
- **Always update `index.md` and `log.md`** after any wiki change
- **Per-source summaries are the ingest ledger** — every ingested source gets a brief `summaries/` page; Lint flags raw files that no summary or page references
- **Link liberally** — cross-references between pages are what give the wiki its value
- **Keep index.md summaries accurate and specific** — at ~100 pages / hundreds of thousands of words, a well-maintained index is what makes direct LLM reads sufficient; RAG is not needed at this scale. As the wiki grows beyond this, introduce search tools (e.g. qmd) as a scaling complement — not a replacement for the index.
- **File outputs back** — query answers are wiki contributions, not disposable chat responses
- **Never assume categories** — always discover them from the actual directory structure or ask during init
- **LLM owns content, human owns meta** — the LLM writes and maintains all wiki content pages; the human owns schema.md, category structure, and high-level decisions. Do not modify schema without human approval.
- **Contradictions require human judgment** — when Lint finds conflicting claims across pages, flag them for human review with both sides cited. Do not silently resolve contradictions by picking one side.
- **Verify ≠ Lint** — Lint is internal wiki health; Verify is alignment with the code. Forward-design pages are not drift; only the current-state claims they assert can drift. Always re-verify fixes independently.
