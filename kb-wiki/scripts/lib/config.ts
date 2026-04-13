import { resolve } from "path"
import { readdir, stat } from "fs/promises"

// Use process.cwd() so scripts work correctly when run from any project root
const ROOT = process.cwd()

export const config = {
  root: ROOT,
  kb: {
    wiki: resolve(ROOT, "kb/wiki"),
    index: resolve(ROOT, "kb/wiki/index.md"),
    log: resolve(ROOT, "kb/wiki/log.md"),
  },
  ai: {
    model: process.env.KB_MODEL ?? "claude-sonnet-4-6",
    maxTokens: Number(process.env.KB_MAX_TOKENS ?? 4096),
  },
} as const

/**
 * Discover wiki categories by scanning kb/wiki/ subdirectories.
 * Generic — works for any project regardless of category names.
 */
export async function discoverCategories(): Promise<string[]> {
  const categories: string[] = []

  let entries: string[]
  try {
    entries = await readdir(config.kb.wiki)
  } catch {
    return categories
  }

  for (const entry of entries) {
    // Skip meta files and known non-category directories
    if (entry.startsWith(".") || entry === "summaries" || entry === "queries") {
      continue
    }
    const fullPath = resolve(config.kb.wiki, entry)
    const s = await stat(fullPath)
    if (s.isDirectory()) {
      categories.push(entry)
    }
  }

  return categories.sort()
}
