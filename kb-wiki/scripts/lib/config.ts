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

export type Effort = "low" | "medium" | "high" | "xhigh" | "max"
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"]

/** Effort-level env override; anything outside the API's enum falls back with a warning. */
export function effortEnv(name: string, fallback: Effort): Effort {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  if ((EFFORTS as readonly string[]).includes(raw)) return raw as Effort
  console.warn(`Ignoring invalid ${name}="${raw}" — using ${fallback} (one of ${EFFORTS.join("/")})`)
  return fallback
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
    // map --deep (cross-link discovery): Sonnet-class is enough.
    model: process.env.KB_MODEL ?? "claude-sonnet-5",
    // lint --deep (contradiction / staleness reasoning over the whole wiki): Opus-class.
    // KB_LINT_MODEL wins; KB_MODEL is honoured as a global override when set.
    lintModel: process.env.KB_LINT_MODEL ?? process.env.KB_MODEL ?? "claude-opus-5",
    // Streaming request → large ceiling is safe; truncation is detected via stop_reason.
    maxTokens: positiveIntEnv("KB_MAX_TOKENS", 32000),
    effort: effortEnv("KB_EFFORT", "high"),
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
