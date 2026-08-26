import { test, expect } from "bun:test"

// map.ts loads ./lib/ai (→ @anthropic-ai/sdk) lazily, only inside the --deep branch, so
// importing parsePage never touches the SDK. (No mock.module here: bun's module mocks leak
// across test files in one run and would blank the SDK's error classes for ai.test.ts.)
import { parsePage, parseIndexSummaries, resolveSummary, resolveProjectName } from "./map"

// parsePage summary precedence: frontmatter `summary:` is canonical (keeps index/MOC
// in lockstep with the page); pages without it fall back to the first body paragraph.

test("parsePage: prefers frontmatter summary over body", () => {
  const page = parsePage(
    "concepts/widget.md",
    `---
title: Widget
summary: The canonical one-line abstract of this page.
category: concepts
tags: [a]
---

This first body paragraph is long enough to be picked by the fallback heuristic.`,
  )
  expect(page.summary).toBe("The canonical one-line abstract of this page.")
})

test("parsePage: quoted summary with an internal colon is captured whole", () => {
  const page = parsePage(
    "concepts/ratio.md",
    `---
title: Ratio
summary: "P/E: a valuation ratio, price over earnings."
category: concepts
tags: [a]
---

body text that is clearly long enough to trip the fallback scanner.`,
  )
  expect(page.summary).toBe("P/E: a valuation ratio, price over earnings.")
})

test("parsePage: legacy page without summary falls back to first body paragraph", () => {
  const page = parsePage(
    "concepts/legacy.md",
    `---
title: Legacy
category: concepts
tags: [a]
---

This is the first meaningful paragraph and should become the summary.`,
  )
  expect(page.summary).toBe("This is the first meaningful paragraph and should become the summary.")
})

test("parsePage: summaries/ ledger page (no summary field) uses body fallback", () => {
  const page = parsePage(
    "summaries/some-source.md",
    `---
source: some-source.md
origin: external
ingested: 2026-06-26
tags: [a]
---

- Key takeaway bullet that the index Sources section should surface.`,
  )
  // body fallback strips no markup; Sources section trims the leading bullet downstream
  expect(page.summary).toBe("- Key takeaway bullet that the index Sources section should surface.")
})

// parseIndexSummaries: harvest existing one-liners so a rebuild can preserve curated
// summaries instead of re-flattening them from page bodies.

test("parseIndexSummaries: harvests category, overview, and Sources lines", () => {
  const index = `# Demo Wiki — Index

> Auto-maintained by \`kb:map\`. Last updated: 2026-06-29

---

## Overview (1)
- [[overview]] — The project big-picture in one curated line.

## Concepts (2)
- [[concepts/ratio]] — P/E: a curated valuation explainer, richer than the body.
- [[concepts/widget]] — A hand-written widget summary worth keeping.

## Sources (1)
- [[summaries/some-source]] — Curated takeaway from the source.

---
**Total: 3 pages**`
  const map = parseIndexSummaries(index)
  expect(map.get("overview")).toBe("The project big-picture in one curated line.")
  expect(map.get("concepts/ratio")).toBe("P/E: a curated valuation explainer, richer than the body.")
  expect(map.get("concepts/widget")).toBe("A hand-written widget summary worth keeping.")
  expect(map.get("summaries/some-source")).toBe("Curated takeaway from the source.")
  expect(map.size).toBe(4)
})

test("parseIndexSummaries: keeps a summary that itself contains an em-dash", () => {
  const map = parseIndexSummaries("- [[concepts/x]] — before — after")
  expect(map.get("concepts/x")).toBe("before — after")
})

test("parseIndexSummaries: ignores headings, separators, and non-entry lines", () => {
  const map = parseIndexSummaries("## Concepts (1)\n\n---\nrandom prose line\n")
  expect(map.size).toBe(0)
})

test("parseIndexSummaries: empty/missing content yields an empty map", () => {
  expect(parseIndexSummaries("").size).toBe(0)
})

// resolveSummary: preserve a non-empty prior summary verbatim; otherwise fall back to
// the freshly-extracted one (frontmatter summary or first-paragraph slice via parsePage).

test("resolveSummary: reuses a non-empty preserved summary verbatim", () => {
  const preserved = new Map([["concepts/widget", "Curated and worth keeping."]])
  expect(resolveSummary("concepts/widget", "crude body slice", preserved)).toBe(
    "Curated and worth keeping.",
  )
})

test("resolveSummary: falls back to extraction when the slug is new", () => {
  const preserved = new Map([["concepts/widget", "old"]])
  expect(resolveSummary("concepts/newpage", "freshly extracted", preserved)).toBe(
    "freshly extracted",
  )
})

test("resolveSummary: falls back when the preserved summary is empty/whitespace", () => {
  const preserved = new Map([["concepts/widget", "   "]])
  expect(resolveSummary("concepts/widget", "freshly extracted", preserved)).toBe(
    "freshly extracted",
  )
})

// resolveProjectName: the wiki title must come from kb/schema.md (Init substitutes the
// project name there), never from the cwd basename — which is the worktree name inside
// .worktrees/<name>/. Falls back to preserving the existing index.md title.

test("resolveProjectName: takes the name from the schema.md title", () => {
  const schema = "# FVG Knowledge Base — Schema\n\nThis file defines conventions."
  expect(resolveProjectName(schema, null)).toBe("FVG")
})

test("resolveProjectName: keeps a multi-word project name", () => {
  expect(resolveProjectName("# My Cool Project Knowledge Base — Schema", null)).toBe(
    "My Cool Project",
  )
})

test("resolveProjectName: schema absent → preserves the existing index.md title name", () => {
  const index = "# FVG Wiki — Index\n\n> Auto-maintained by `kb:map`."
  expect(resolveProjectName(null, index)).toBe("FVG")
})

test("resolveProjectName: unsubstituted {{PROJECT_NAME}} is ignored, falls through to index", () => {
  const schema = "# {{PROJECT_NAME}} Knowledge Base — Schema"
  const index = "# FVG Wiki — Index"
  expect(resolveProjectName(schema, index)).toBe("FVG")
})

test("resolveProjectName: schema wins over the existing index title", () => {
  expect(resolveProjectName("# FVG Knowledge Base — Schema", "# Old Name Wiki — Index")).toBe("FVG")
})

test("resolveProjectName: nothing usable → neutral 'Project', never the cwd", () => {
  expect(resolveProjectName(null, null)).toBe("Project")
  expect(resolveProjectName("# no title here", "no index title")).toBe("Project")
})

// ─── Cross-link suggestions (structured output plumbing) ──

import { normalizeSuggestions } from "./map"

test("normalizeSuggestions: non-array or malformed payloads never reach injectLinks", () => {
  expect(normalizeSuggestions(undefined)).toEqual([])
  expect(normalizeSuggestions({ links: [] })).toEqual([])
  expect(
    normalizeSuggestions([
      { source: "a/x", target: "a/y", reason: "r" },
      { source: "a/x", target: "a/x", reason: "self" },
      { source: "a/x", target: 42, reason: "r" },
      null,
    ]),
  ).toEqual([{ source: "a/x", target: "a/y", reason: "r" }])
})
