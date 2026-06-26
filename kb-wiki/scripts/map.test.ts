import { test, expect, mock } from "bun:test"

// map.ts statically imports ./lib/ai → @anthropic-ai/sdk, which isn't installed in
// this skill repo (it's auto-installed only when a script is run directly). Stub it
// so we can import the pure parsePage without the SDK present. parsePage uses none of it.
mock.module("@anthropic-ai/sdk", () => ({ default: class {} }))
const { parsePage } = await import("./map")

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
