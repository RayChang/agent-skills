import { resolve } from "path"
import { readdir, stat } from "fs/promises"

// Use process.cwd() so scripts work correctly when run from any project root
const ROOT = process.cwd()

/**
 * Positive-integer env override with a fallback. A typo'd value previously flowed
 * straight into the API call (Number("4k") → maxTokens: NaN → request rejected).
 */
export function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    console.warn(`Ignoring invalid ${name}="${raw}" — using ${fallback}`)
    return fallback
  }
  return n
}

export const config = {
  root: ROOT,
  kb: {
    wiki: resolve(ROOT, "kb/wiki"),
    index: resolve(ROOT, "kb/wiki/index.md"),
    schema: resolve(ROOT, "kb/schema.md"),
    logDir: resolve(ROOT, "kb/wiki/log"),
    legacyLog: resolve(ROOT, "kb/wiki/log.md"),
    rawSources: resolve(ROOT, "kb/raw/sources"),
  },
  ai: {
    model: process.env.KB_MODEL ?? "claude-sonnet-4-6",
    maxTokens: positiveIntEnv("KB_MAX_TOKENS", 4096),
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
    // Skip meta directories only: "summaries" is the ingest ledger, "log" the activity
    // trail. Everything else (a queries/ dir included) is a real category — hardcoding
    // more names here silently drops those pages from the index and MOCs.
    if (entry.startsWith(".") || entry === "summaries" || entry === "log") {
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
