import { test, expect } from "bun:test"
import { checkBrokenLinks, checkOrphanPages, checkUningestedSources } from "./lint"

type Page = { relativePath: string; content: string }
const page = (relativePath: string, content: string): Page => ({ relativePath, content })

// ─── broken links ─────────────────────────────────────────

test("checkBrokenLinks: flags a content page's dangling link", async () => {
  const issues = await checkBrokenLinks([page("concepts/alpha.md", "see [[concepts/missing]]")])
  expect(issues).toHaveLength(1)
  expect(issues[0].category).toBe("broken-link")
  expect(issues[0].file).toBe("concepts/alpha.md")
})

test("checkBrokenLinks: a lint report quoting a broken link is not itself flagged", async () => {
  // Regression: reports quote `[[link]]` verbatim; scanning them re-reported every
  // fixed link as a fresh warning on the next run, forever.
  const issues = await checkBrokenLinks([
    page("lint-report-2026-07-01.md", "- [!] Broken link [[concepts/deleted]] — target does not exist"),
  ])
  expect(issues).toHaveLength(0)
})

test("checkBrokenLinks: log links are skipped (append-only history)", async () => {
  const issues = await checkBrokenLinks([
    page("log/dev.md", "- Pages created: [[concepts/renamed-away]]"),
  ])
  expect(issues).toHaveLength(0)
})

// ─── orphan pages ─────────────────────────────────────────

// Regression fixture: loner is linked ONLY from mechanical files (index, MOC, log,
// lint report) — every page a logged ingest ever created has such links, so counting
// them meant orphan detection never fired.
const ORPHAN_FIXTURE: Page[] = [
  page("index.md", "- [[concepts/alpha]]\n- [[concepts/beta]]\n- [[concepts/loner]]"),
  page("concepts/_moc.md", "## [[concepts/loner|Loner]]"),
  page("log/dev.md", "- Pages created: [[concepts/loner]]"),
  page("lint-report-2026-07-01.md", "orphan? [[concepts/loner]]"),
  page("concepts/alpha.md", "links to [[concepts/beta]]"),
  page("concepts/beta.md", "no outbound links here"),
  page("concepts/loner.md", "nobody content-links this page"),
]

test("checkOrphanPages: index/MOC/log/lint-report links don't rescue an orphan", () => {
  const files = checkOrphanPages(ORPHAN_FIXTURE).map((i) => i.file)
  expect(files).toContain("concepts/loner.md")
  expect(files).toContain("concepts/alpha.md") // only index.md links it
  expect(files).not.toContain("concepts/beta.md") // alpha, a content page, links it
})

test("checkOrphanPages: meta files are never orphan candidates", () => {
  const files = checkOrphanPages(ORPHAN_FIXTURE).map((i) => i.file)
  for (const meta of ["index.md", "concepts/_moc.md", "log/dev.md", "lint-report-2026-07-01.md"]) {
    expect(files).not.toContain(meta)
  }
})

// ─── un-ingested sources ──────────────────────────────────

test("checkUningestedSources: unreferenced short-stem source is flagged (no prose-substring rescue)", () => {
  // Regression: includes(stem) matched the article "a" in ordinary prose, silently
  // marking the never-ingested a.md as ingested.
  const pages = [page("concepts/x.md", "a paragraph with the article a in it, and another word")]
  const issues = checkUningestedSources(pages, ["a.md"])
  expect(issues).toHaveLength(1)
  expect(issues[0].category).toBe("un-ingested")
})

test("checkUningestedSources: raw-source citation counts as referenced (missing-summary only)", () => {
  const pages = [page("concepts/x.md", "cited → raw/sources/notes-2026.md inline")]
  const issues = checkUningestedSources(pages, ["notes-2026.md"])
  expect(issues).toHaveLength(1)
  expect(issues[0].category).toBe("missing-summary")
})

test("checkUningestedSources: a summaries/ ledger entry silences both checks", () => {
  const pages = [
    page("concepts/x.md", "cited → raw/sources/notes-2026.md inline"),
    page("summaries/notes-2026.md", "---\nsource: notes-2026.md\n---\n\n- takeaway"),
  ]
  expect(checkUningestedSources(pages, ["notes-2026.md"])).toHaveLength(0)
})

test("checkUningestedSources: citation of the markdown conversion covers the original", () => {
  // Original report.pdf; the ledger cites the converted report.pdf.md — the base
  // token "report.pdf" is still found (bounded by the following dot).
  const pages = [page("summaries/report.md", "---\nsource: report.pdf.md\n---\n\n- takeaway")]
  const categories = checkUningestedSources(pages, ["report.pdf"]).map((i) => i.category)
  expect(categories).not.toContain("un-ingested")
})

test("checkUningestedSources: slug-embedded name does not count as a reference", () => {
  // "notes" inside the longer slug "footnotes-guide" must not mark notes.md ingested.
  const pages = [page("concepts/x.md", "see [[concepts/footnotes-guide]] for details")]
  const issues = checkUningestedSources(pages, ["notes.md"])
  expect(issues.map((i) => i.category)).toContain("un-ingested")
})
