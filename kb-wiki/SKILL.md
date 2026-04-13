---
name: kb-wiki
description: This skill should be used when working with a project knowledge base that follows the Karpathy LLM Wiki pattern. It provides workflows for ingesting source documents, querying the KB, running health checks (lint), capturing design decisions and lessons learned, and initializing a new KB in a project. Trigger when the user mentions the KB, asks to ingest a source, run a query against the wiki, capture learnings, or set up a knowledge base.
---

# KB Wiki Skill

A methodology for LLM-maintained knowledge bases based on Andrej Karpathy's LLM Wiki pattern. LLMs maintain the wiki; humans curate sources and ask questions.

**Schema reference**: Load `references/schema.md` for page format, link conventions, directory structure, and log format details.

**New project assets**: `assets/schema.md` is a template — copy to `kb/schema.md` with project name and categories substituted when initializing.

---

## Guard: check KB exists before any operation

Before running Ingest, Query, Lint, Map, or Capture — check whether `kb/wiki/index.md` exists. If it does not, stop and tell the user:

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
6. Tell the user: KB initialized with categories: {list}. Drop source documents into `kb/raw/sources/` and run `/kb-wiki ingest`.

---

### Ingest — Process a new source document

To ingest a source from `kb/raw/sources/`:

1. Read `kb/wiki/index.md` to understand existing wiki content and discover what categories exist
2. Read the source document fully
3. Identify which existing wiki pages it relates to, and what new pages are needed
4. Create new pages and/or update existing pages — a single source can touch multiple pages
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
- **Keep index.md summaries accurate and specific** — at ~100 pages / hundreds of thousands of words, a well-maintained index is what makes direct LLM reads sufficient; RAG is not needed at this scale. Vague summaries break this.
- **File outputs back** — query answers are wiki contributions, not disposable chat responses
- **Never assume categories** — always discover them from the actual directory structure or ask during init
