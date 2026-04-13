#!/usr/bin/env bun
/**
 * map.ts — Index & Relationship Builder
 *
 * Maintains the knowledge graph structure:
 * 1. Rebuilds index.md with categorized page listing
 * 2. Generates per-category MOC (Map of Content) files
 * 3. Optionally uses LLM to discover and inject missing cross-links
 *
 * Usage (run from project root):
 *   bun ~/.claude/skills/kb-wiki/scripts/map.ts          # Rebuild index + MOC
 *   bun ~/.claude/skills/kb-wiki/scripts/map.ts --deep   # Also discover missing links via LLM
 */

import { resolve } from "path"
import { config, discoverCategories } from "./lib/config"
import { askJson } from "./lib/ai"
import { readAllWikiPages, appendLog, todayDate } from "./lib/kb"

// ─── Types ────────────────────────────────────────────────

interface PageInfo {
  relativePath: string
  slug: string
  title: string
  category: string
  tags: string[]
  summary: string
  outboundLinks: string[]
  content: string
}

// ─── Page Parser ──────────────────────────────────────────

function parsePage(relativePath: string, content: string): PageInfo {
  const slug = relativePath.replace(".md", "")
  const parts = relativePath.split("/")
  const category = parts.length > 1 ? parts[0] : "root"

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  const fm = fmMatch?.[1] ?? ""

  const titleMatch =
    fm.match(/title:\s*"?(.+?)"?\s*$/m) ?? content.match(/^# (.+)$/m)
  const title = titleMatch?.[1] ?? slug

  const tagsMatch = fm.match(/tags:\s*\[(.+)\]/)
  const tags = tagsMatch
    ? tagsMatch[1].split(",").map((t) => t.trim().replace(/[\[\]"']/g, ""))
    : []

  // First meaningful paragraph as summary
  let summary = ""
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (
      trimmed &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith(">") &&
      !trimmed.startsWith("---") &&
      !/^(title|category|tags|sources|created|updated):/.test(trimmed) &&
      trimmed.length > 20
    ) {
      summary = trimmed.slice(0, 150)
      break
    }
  }

  const linkMatches = content.matchAll(/\[\[([^\]]+)\]\]/g)
  const outboundLinks = [...linkMatches].map((m) => m[1].replace(".md", ""))

  return { relativePath, slug, title, category, tags, summary, outboundLinks, content }
}

// ─── Index Builder ────────────────────────────────────────

async function buildIndex(pages: PageInfo[]): Promise<string> {
  const categories = await discoverCategories()
  const byCategory = new Map<string, PageInfo[]>()

  for (const page of pages) {
    if (
      page.relativePath.startsWith("summaries/") ||
      page.relativePath === "index.md" ||
      page.relativePath === "log.md" ||
      page.relativePath.startsWith("lint-report-")
    ) continue

    const cat = page.category
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push(page)
  }

  const lines = [
    `# ${detectProjectName()} Wiki — Index`,
    "",
    `> Auto-maintained by \`kb:map\`. Last updated: ${todayDate()}`,
    "",
    "---",
    "",
  ]

  // Root pages first (overview.md, etc.)
  const root = byCategory.get("root") ?? []
  if (root.length > 0) {
    lines.push(`## Overview (${root.length})`)
    for (const p of root.sort((a, b) => a.title.localeCompare(b.title))) {
      lines.push(`- [[${p.slug}]] — ${p.summary || p.title}`)
    }
    lines.push("")
  }

  let totalPages = root.length
  for (const cat of categories) {
    const catPages = byCategory.get(cat) ?? []
    if (catPages.length === 0) continue
    totalPages += catPages.length
    const label = cat.charAt(0).toUpperCase() + cat.slice(1)
    lines.push(`## ${label} (${catPages.length})`)
    for (const p of catPages.sort((a, b) => a.title.localeCompare(b.title))) {
      lines.push(`- [[${p.slug}]] — ${p.summary || p.title}`)
    }
    lines.push("")
  }

  lines.push("---", `**Total: ${totalPages} pages**`)
  return lines.join("\n")
}

function detectProjectName(): string {
  // Read from kb/schema.md title if possible, else fall back to directory name
  try {
    const { basename } = require("path")
    return basename(process.cwd())
  } catch {
    return "Project"
  }
}

// ─── MOC Builder ──────────────────────────────────────────

function buildMoc(category: string, pages: PageInfo[]): string {
  const label = category.charAt(0).toUpperCase() + category.slice(1)
  const lines = [
    `# ${label} — Map of Content`,
    "",
    `> Auto-maintained by \`kb:map\`. Last updated: ${todayDate()}`,
    "",
    "---",
    "",
  ]

  for (const page of pages.sort((a, b) => a.title.localeCompare(b.title))) {
    lines.push(`## [[${page.slug}|${page.title}]]`)
    if (page.summary) lines.push("", page.summary)
    if (page.tags.length > 0) {
      lines.push("", `Tags: ${page.tags.map((t) => `\`${t}\``).join(", ")}`)
    }
    const connections = page.outboundLinks.filter(
      (l) => !l.startsWith("index") && !l.startsWith("log"),
    )
    if (connections.length > 0) {
      lines.push("", `Links to: ${connections.map((l) => `[[${l}]]`).join(", ")}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

// ─── LLM Cross-Link Discovery ─────────────────────────────

interface LinkSuggestion {
  source: string
  target: string
  reason: string
}

const MAP_SYSTEM = `You are a knowledge graph analyst. Find missing connections between wiki pages that should reference each other but don't.`

async function discoverMissingLinks(
  pages: PageInfo[],
): Promise<{ suggestions: LinkSuggestion[]; tokens: { input: number; output: number } }> {
  const pageList = pages
    .filter(
      (p) =>
        !p.relativePath.startsWith("summaries/") &&
        p.relativePath !== "index.md" &&
        p.relativePath !== "log.md" &&
        !p.relativePath.startsWith("lint-report-"),
    )
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      tags: p.tags,
      linksTo: p.outboundLinks,
      summary: p.summary,
    }))

  const prompt = `Find missing bidirectional links between these wiki pages.

## Pages
${JSON.stringify(pageList, null, 2)}

Rules:
- Only suggest links where there is a genuine conceptual relationship
- Do not suggest links to index.md or log.md
- Max 20 suggestions

Return JSON array only:
[{ "source": "category/page-slug", "target": "category/other-slug", "reason": "brief explanation" }]`

  const { data, inputTokens, outputTokens } = await askJson<LinkSuggestion[]>(prompt, {
    system: MAP_SYSTEM,
  })

  return { suggestions: data, tokens: { input: inputTokens, output: outputTokens } }
}

async function injectLinks(suggestions: LinkSuggestion[], pages: PageInfo[]): Promise<string[]> {
  const modified: string[] = []
  const pageMap = new Map(pages.map((p) => [p.slug, p]))

  for (const suggestion of suggestions) {
    const sourcePage = pageMap.get(suggestion.source)
    if (!sourcePage) continue
    if (sourcePage.outboundLinks.includes(suggestion.target)) continue

    const fullPath = resolve(config.kb.wiki, sourcePage.relativePath)
    let content = await Bun.file(fullPath).text()

    if (content.includes(`[[${suggestion.target}]]`)) continue

    const seeAlsoMatch = content.match(/## See Also\n/)
    if (seeAlsoMatch?.index !== undefined) {
      const insertPoint = content.indexOf("\n", seeAlsoMatch.index) + 1
      content = content.slice(0, insertPoint) + `- [[${suggestion.target}]]\n` + content.slice(insertPoint)
    } else {
      content += `\n## See Also\n- [[${suggestion.target}]]\n`
    }

    await Bun.write(fullPath, content)
    modified.push(`${sourcePage.slug} → [[${suggestion.target}]] (${suggestion.reason})`)
  }

  return modified
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const deep = args.includes("--deep")

  console.log(`KB Map — ${deep ? "deep mode (with LLM)" : "structural rebuild"}...\n`)

  const rawPages = await readAllWikiPages()
  const pages = rawPages.map((p) => parsePage(p.relativePath, p.content))
  const categories = await discoverCategories()
  console.log(`Found ${pages.length} wiki pages across categories: ${categories.join(", ")}\n`)

  // Rebuild index.md
  process.stdout.write("Rebuilding index.md...")
  const indexContent = await buildIndex(pages)
  await Bun.write(config.kb.index, indexContent + "\n")
  console.log(" done")

  // Generate per-category MOC files
  let mocCount = 0
  for (const cat of categories) {
    const catPages = pages.filter((p) => p.category === cat)
    if (catPages.length === 0) continue

    const mocContent = buildMoc(cat, catPages)
    const mocPath = resolve(config.kb.wiki, cat, "_moc.md")
    await Bun.write(mocPath, mocContent + "\n")
    mocCount++
    console.log(`  MOC: ${cat}/_moc.md (${catPages.length} pages)`)
  }

  // Stats
  const contentPages = pages.filter(
    (p) =>
      !p.relativePath.startsWith("summaries/") &&
      p.relativePath !== "index.md" &&
      p.relativePath !== "log.md" &&
      !p.relativePath.startsWith("lint-report-"),
  )
  const totalLinks = contentPages.reduce((sum, p) => sum + p.outboundLinks.length, 0)
  const orphans = contentPages.filter((p) => {
    return !contentPages.some(
      (other) => other.slug !== p.slug && other.outboundLinks.includes(p.slug),
    )
  })

  console.log(`\n─── Stats ───`)
  console.log(`Pages:          ${contentPages.length}`)
  console.log(`Total links:    ${totalLinks}`)
  console.log(`Avg links/page: ${(totalLinks / (contentPages.length || 1)).toFixed(1)}`)
  console.log(`Orphan pages:   ${orphans.length}`)

  // LLM cross-link discovery
  let injectedLinks: string[] = []
  let totalTokens = 0

  if (deep) {
    console.log("\nRunning LLM cross-link discovery...")
    const { suggestions, tokens } = await discoverMissingLinks(contentPages)
    totalTokens = tokens.input + tokens.output
    console.log(`Found ${suggestions.length} suggestions (${totalTokens} tokens)`)

    if (suggestions.length > 0) {
      injectedLinks = await injectLinks(suggestions, pages)
      console.log(`Injected ${injectedLinks.length} new links`)
      for (const link of injectedLinks) console.log(`  + ${link}`)
    }
  }

  await appendLog("map", `Rebuilt index + ${mocCount} MOCs`, [
    `Pages indexed: ${contentPages.length}`,
    `Total links: ${totalLinks}`,
    `Orphan pages: ${orphans.length}`,
    ...(deep
      ? [`LLM mode: discovered ${injectedLinks.length} new links`, `Tokens: ${totalTokens}`]
      : []),
  ])

  console.log("\nMap complete.")
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
