#!/usr/bin/env bun
/**
 * lint.ts — Wiki Health Checker
 *
 * Scans the wiki for structural issues and optionally runs LLM deep analysis.
 *
 * Usage (run from project root):
 *   bun ~/.claude/skills/kb-wiki/scripts/lint.ts          # Structural checks only
 *   bun ~/.claude/skills/kb-wiki/scripts/lint.ts --deep   # Include LLM content analysis
 */

import { resolve } from "path"
import { config, discoverCategories } from "./lib/config"
import { ask } from "./lib/ai"
import { readAllWikiPages, appendLog, todayDate } from "./lib/kb"

// ─── Types ────────────────────────────────────────────────

interface LintIssue {
  severity: "error" | "warning" | "info"
  category: string
  message: string
  file?: string
}

// ─── Structural Checks ───────────────────────────────────

function extractWikiLinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([^\]]+)\]\]/g)
  return [...matches].map((m) => m[1].split("|")[0].trim())
}

async function checkBrokenLinks(
  pages: Array<{ relativePath: string; content: string }>,
): Promise<LintIssue[]> {
  const issues: LintIssue[] = []
  const validPaths = new Set(pages.map((p) => p.relativePath.replace(".md", "")))

  for (const page of pages) {
    if (page.relativePath.startsWith("summaries/")) continue

    const links = extractWikiLinks(page.content)
    for (const link of links) {
      const normalized = link.replace(".md", "")
      if (!validPaths.has(normalized)) {
        issues.push({
          severity: "warning",
          category: "broken-link",
          message: `Broken link [[${link}]] — target does not exist`,
          file: page.relativePath,
        })
      }
    }
  }

  return issues
}

function checkOrphanPages(
  pages: Array<{ relativePath: string; content: string }>,
): LintIssue[] {
  const issues: LintIssue[] = []

  const allLinkedPaths = new Set<string>()
  for (const page of pages) {
    for (const link of extractWikiLinks(page.content)) {
      allLinkedPaths.add(link.replace(".md", ""))
    }
  }

  for (const page of pages) {
    const path = page.relativePath.replace(".md", "")
    if (
      path === "index" ||
      path === "log" ||
      path === "overview" ||
      page.relativePath.endsWith("_moc.md") ||
      page.relativePath.match(/^lint-report-/) ||
      page.relativePath.startsWith("summaries/")
    ) continue

    if (!allLinkedPaths.has(path)) {
      issues.push({
        severity: "info",
        category: "orphan",
        message: `Orphan page — no other page links to it`,
        file: page.relativePath,
      })
    }
  }

  return issues
}

function checkMissingFrontmatter(
  pages: Array<{ relativePath: string; content: string }>,
): LintIssue[] {
  const issues: LintIssue[] = []

  for (const page of pages) {
    if (
      page.relativePath === "index.md" ||
      page.relativePath === "log.md" ||
      page.relativePath.endsWith("_moc.md") ||
      page.relativePath.match(/^lint-report-/) ||
      page.relativePath.startsWith("summaries/")
    ) continue

    if (!page.content.startsWith("---")) {
      issues.push({
        severity: "warning",
        category: "frontmatter",
        message: `Missing YAML frontmatter`,
        file: page.relativePath,
      })
      continue
    }

    const fmMatch = page.content.match(/^---\n([\s\S]*?)\n---/)
    if (!fmMatch) continue
    const fm = fmMatch[1]

    for (const field of ["title", "category", "tags"]) {
      if (!fm.includes(`${field}:`)) {
        issues.push({
          severity: "warning",
          category: "frontmatter",
          message: `Missing frontmatter field: ${field}`,
          file: page.relativePath,
        })
      }
    }
  }

  return issues
}

async function checkEmptyCategories(
  pages: Array<{ relativePath: string; content: string }>,
): Promise<LintIssue[]> {
  const issues: LintIssue[] = []
  const categories = await discoverCategories()

  const categoryCounts = new Map<string, number>()
  for (const page of pages) {
    const parts = page.relativePath.split("/")
    if (parts.length > 1 && !page.relativePath.startsWith("summaries/")) {
      const cat = parts[0]
      categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1)
    }
  }

  for (const cat of categories) {
    if (!categoryCounts.has(cat) || categoryCounts.get(cat) === 0) {
      issues.push({
        severity: "info",
        category: "coverage",
        message: `Category "${cat}" has no pages`,
      })
    }
  }

  return issues
}

// ─── LLM Deep Analysis ───────────────────────────────────

const LINT_SYSTEM = `You are a knowledge base quality auditor. Analyze wiki content for inconsistencies, contradictions, gaps, and staleness. Be specific — cite exact pages and claims.`

async function deepAnalysis(
  pages: Array<{ relativePath: string; content: string }>,
): Promise<{ issues: LintIssue[]; tokens: { input: number; output: number } }> {
  const condensed = pages
    .filter(
      (p) =>
        !p.relativePath.startsWith("summaries/") &&
        p.relativePath !== "index.md" &&
        p.relativePath !== "log.md",
    )
    .map((p) => {
      const truncated = p.content.length > 2000
        ? p.content.slice(0, 2000) + "\n[...truncated]"
        : p.content
      return `=== ${p.relativePath} ===\n${truncated}`
    })
    .join("\n\n")

  const prompt = `Analyze this wiki for quality issues.

## Wiki Contents
${condensed}

## Check for:
1. **Contradictions** — pages that claim conflicting things
2. **Stale information** — decisions or facts that may have been superseded
3. **Missing pages** — concepts mentioned but lacking their own page
4. **Weak cross-references** — pages that should link to each other but don't
5. **Content gaps** — important topics not yet covered

Return a structured report as a markdown list. For each issue include severity (error/warning/info), category, and specific description.`

  const response = await ask(prompt, { system: LINT_SYSTEM, maxTokens: 4096 })

  const issues: LintIssue[] = []
  for (const line of response.content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("-") && !trimmed.startsWith("*")) continue

    let severity: LintIssue["severity"] = "info"
    if (/\berror\b/i.test(trimmed)) severity = "error"
    else if (/\bwarning\b/i.test(trimmed)) severity = "warning"

    let category = "llm-analysis"
    if (/\bcontradiction\b/i.test(trimmed)) category = "contradiction"
    else if (/\bstale\b/i.test(trimmed)) category = "stale"
    else if (/\bmissing.page\b/i.test(trimmed)) category = "missing-page"
    else if (/\bweak.link\b|cross.ref/i.test(trimmed)) category = "weak-link"
    else if (/\bgap\b/i.test(trimmed)) category = "gap"

    issues.push({ severity, category, message: trimmed.replace(/^[-*]\s*/, "") })
  }

  return { issues, tokens: { input: response.inputTokens, output: response.outputTokens } }
}

// ─── Report ───────────────────────────────────────────────

function formatReport(issues: LintIssue[]): string {
  const byCategory = new Map<string, LintIssue[]>()
  for (const issue of issues) {
    if (!byCategory.has(issue.category)) byCategory.set(issue.category, [])
    byCategory.get(issue.category)!.push(issue)
  }

  const errors = issues.filter((i) => i.severity === "error").length
  const warnings = issues.filter((i) => i.severity === "warning").length
  const infos = issues.filter((i) => i.severity === "info").length

  const lines = [
    "# Wiki Health Check Report",
    "",
    `Date: ${new Date().toISOString()}`,
    "",
    `**Summary: ${errors} errors, ${warnings} warnings, ${infos} info**`,
    "",
  ]

  for (const [category, catIssues] of byCategory) {
    lines.push(`## ${category}`, "")
    for (const issue of catIssues) {
      const icon = issue.severity === "error" ? "x" : issue.severity === "warning" ? "!" : "i"
      const file = issue.file ? ` (${issue.file})` : ""
      lines.push(`- [${icon}] ${issue.message}${file}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const deep = args.includes("--deep")

  console.log(`KB Lint — ${deep ? "deep analysis (with LLM)" : "structural checks"}...\n`)

  const pages = await readAllWikiPages()
  console.log(`Scanning ${pages.length} wiki pages...\n`)

  const allIssues: LintIssue[] = [
    ...(await checkBrokenLinks(pages)),
    ...checkOrphanPages(pages),
    ...checkMissingFrontmatter(pages),
    ...(await checkEmptyCategories(pages)),
  ]

  let totalTokens = 0

  if (deep) {
    console.log("Running LLM deep analysis...\n")
    const { issues, tokens } = await deepAnalysis(pages)
    allIssues.push(...issues)
    totalTokens = tokens.input + tokens.output
  }

  const report = formatReport(allIssues)
  console.log(report)

  const reportPath = resolve(config.kb.wiki, `lint-report-${todayDate()}.md`)
  await Bun.write(reportPath, report)
  console.log(`Report saved to: ${reportPath}`)

  const errors = allIssues.filter((i) => i.severity === "error").length
  const warnings = allIssues.filter((i) => i.severity === "warning").length
  const infos = allIssues.filter((i) => i.severity === "info").length

  await appendLog(
    "lint",
    `Health check: ${errors} errors, ${warnings} warnings, ${infos} info`,
    [
      `Mode: ${deep ? "deep (LLM)" : "structural"}`,
      `Pages scanned: ${pages.length}`,
      `Issues found: ${allIssues.length}`,
      ...(totalTokens > 0 ? [`Tokens used: ${totalTokens}`] : []),
    ],
  )

  if (errors > 0) process.exit(1)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
