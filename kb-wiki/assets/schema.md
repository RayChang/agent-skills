# {{PROJECT_NAME}} Knowledge Base — Schema

This file defines the conventions, structure, and workflows for maintaining the {{PROJECT_NAME}} knowledge base. It is the operating manual for any LLM working with this KB.

---

## Architecture

```
kb/
├── raw/
│   ├── sources/    # Immutable source documents — read only, never modify
│   └── assets/     # Images, diagrams
├── wiki/
│   ├── index.md    # Content catalog (update after every wiki change)
│   ├── log.md      # Chronological activity log (append-only)
│   ├── overview.md # High-level project synthesis — updated by Ingest when the big picture shifts
│   ├── summaries/  # One brief page per ingested source — ingest ledger + retrieval backbone
│   └── {categories}/   # Project-specific — defined at init time
└── schema.md       # This file
```

Categories in `wiki/` are defined when the KB is initialized and reflect the project's domain. Do not add new top-level category directories without updating this file.

## Page Status

- **seedling** — newly created, incomplete or speculative
- **developing** — has substance, needs more sources or cross-validation
- **mature** — well-sourced, cross-linked, stable

New pages default to `seedling`. Promote during Ingest or Lint.

## Roles

- **Human**: curates raw sources, asks questions, directs analysis, makes decisions, owns the schema (meta-layer)
- **LLM**: writes and maintains all wiki content pages, never modifies raw sources or schema without human approval

## Page Format

Every wiki page uses this structure:

```markdown
---
title: Page Title
category: {category}
tags: [tag1, tag2]
status: seedling | developing | mature
sources: [filename in raw/sources, or URL]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Page Title

Content here. Use [[wiki-links]] for cross-references to other wiki pages.
Use `→ raw/sources/filename.md` to cite raw sources.

## See Also
- [[category/related-page-1]]
- [[category/related-page-2]]
```

## Wiki Link Convention

- Cross-reference other wiki pages: `[[category/page-name]]`
- With display label: `[[category/page-name|Display Label]]`

## Operations

### Ingest

When a new source is added to `raw/sources/`:

1. Read the source document fully (convert non-markdown sources to a new markdown file first; never alter the original)
2. Create or update relevant wiki pages (may touch multiple pages). A concept mentioned only in passing stays in the summary's Key Terms until a second source touches it
3. Write a brief per-source summary in `wiki/summaries/` (frontmatter: `source`, optional `origin`, `ingested`, `tags`; 3–6 takeaway bullets; Key Terms; pages touched)
4. Update `wiki/overview.md` if the source shifts the big picture
5. Update `wiki/index.md` with new/changed pages and the new summary in the Sources section
6. Append entry to `wiki/log.md`

### Query

When answering questions against the KB:

1. Read `wiki/index.md` to find relevant pages
2. Read relevant wiki pages
3. Synthesize answer with citations — prose, comparison table, or report page as the question demands
4. Separate sourced claims (cited) from own inference (labeled); keep open questions open
5. File substantial answers back into the wiki as new or enriched pages

### Lint

Periodic health checks:

- Find broken `[[wiki-links]]`
- Find orphan pages (no inbound links)
- Find raw sources with no `summaries/` page (un-ingested)
- Find concepts mentioned but lacking their own page
- Find contradictions or stale information
- Suggest follow-up questions and gaps a web search could fill

### Map

Rebuild navigation structure:

- Rebuild `wiki/index.md` with accurate one-line summaries (categories + Sources section)
- Regenerate `{category}/_moc.md` files (summaries get no MOC)
- Add missing cross-links between related pages

### Verify

Drift audit — check wiki pages against the actual codebase (distinct from Lint's internal-health check):

- Classify pages: code-verifiable / forward-design / external (skip external)
- Extract concrete claims (paths, aliases, symbols, configs) and verify against real files with `file:line`
- Verdicts: ✅ match / ⚠️ drift / 🅿️ not-yet-built / ❓ unverifiable
- Fix drifts, then independently re-verify; forward-design prescriptions are not drift

### Capture

After completing a Phase or significant implementation block:

- Extract design decisions with rationale
- Extract pitfalls / workarounds
- Extract reusable patterns

Do not capture: implementation progress, code snippets already in the codebase, ephemeral task state.

## Index Format (wiki/index.md)

Each entry: `- [[category/page-name]] — one-line summary`

## Log Format (wiki/log.md)

```markdown
## [YYYY-MM-DD] action | Description
- Details of what changed
- Pages created/updated: [[page1]], [[page2]]
```

Actions: `ingest`, `query`, `lint`, `map`, `verify`, `capture`, `update`, `restructure`
