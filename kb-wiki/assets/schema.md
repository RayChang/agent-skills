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
│   ├── overview.md # High-level project synthesis
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

1. Read the source document fully
2. Create or update relevant wiki pages (may touch multiple pages)
3. Update `wiki/index.md` with new/changed pages
4. Append entry to `wiki/log.md`

### Query

When answering questions against the KB:

1. Read `wiki/index.md` to find relevant pages
2. Read relevant wiki pages
3. Synthesize answer with citations
4. File substantial answers back into the wiki as new or enriched pages

### Lint

Periodic health checks:

- Find broken `[[wiki-links]]`
- Find orphan pages (no inbound links)
- Find concepts mentioned but lacking their own page
- Find contradictions or stale information

### Map

Rebuild navigation structure:

- Rebuild `wiki/index.md` with accurate one-line summaries
- Regenerate `{category}/_moc.md` files
- Add missing cross-links between related pages

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

Actions: `ingest`, `query`, `lint`, `map`, `capture`, `update`, `restructure`
