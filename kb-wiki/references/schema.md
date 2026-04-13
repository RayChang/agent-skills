# KB Wiki Schema Reference

## Directory Structure

```
kb/
├── raw/
│   ├── sources/    # Immutable source documents — read only, never modify
│   └── assets/     # Images, diagrams
├── wiki/
│   ├── index.md    # Content catalog — update after every wiki change
│   ├── log.md      # Append-only chronological activity log
│   ├── overview.md # High-level project synthesis
│   ├── concepts/
│   ├── integrations/
│   ├── competitors/
│   ├── patterns/
│   └── lessons/
└── schema.md       # Project-specific KB conventions (copy from skill asset)
```

Categories are suggestions — adapt to the project's domain.

## Page Format

Every wiki page uses this frontmatter + structure:

```markdown
---
title: Page Title
category: concepts | integrations | competitors | patterns | lessons
tags: [tag1, tag2]
sources: [filename in raw/sources, or URL]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Page Title

Content here. Use [[wiki-links]] for cross-references.
Use `→ raw/sources/filename.md` to cite raw sources inline.

## See Also
- [[category/related-page]]
```

## Wiki Link Convention

- Cross-reference format: `[[category/page-name]]`
- With display label: `[[category/page-name|Display Label]]`
- Examples: `[[integrations/github-webhooks]]`, `[[patterns/error-triage]]`

## index.md Format

```markdown
# Project Wiki — Index

> Auto-maintained by kb:map. Last updated: YYYY-MM-DD

## Category Name (N)
- [[category/page-name]] — one-line summary of page content

---
**Total: N pages**
```

## log.md Format

```markdown
# Project Wiki — Log

> Append-only chronological record. Newest entries at top.

---

## [YYYY-MM-DD] action | Short description
- Details of what changed
- Pages created: [[page1]]
- Pages updated: [[page2]]
```

Valid actions: `ingest`, `query`, `lint`, `update`, `restructure`, `capture`

## Roles

- **Human**: curates raw sources, asks questions, directs analysis, makes decisions
- **LLM**: writes and maintains all wiki content, never modifies raw sources
