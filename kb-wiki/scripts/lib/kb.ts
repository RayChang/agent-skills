import { readdir, stat, readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { resolve, relative, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { config } from "./config.ts"

// ─── Developer identity ───────────────────────────────────

/**
 * Filename-safe slug for a developer identifier. NOT the Init shell allowlist:
 * this value only becomes a path component (writeText), never a shell argument,
 * so unicode letters are preserved while path-dangerous characters are removed.
 */
export function slugifyDev(raw: string): string {
  let s = raw.trim().toLowerCase()
  s = s.replace(/\s+/g, "-")            // whitespace runs → hyphen
  s = s.replace(/[\/\\]/g, "-")         // path separators → hyphen
  s = s.replace(/\.{2,}/g, "-")         // collapse ".." (traversal) → hyphen
  s = s.replace(/[\x00-\x1f\x7f]/g, "") // strip control chars
  s = s.replace(/^[.\-]+/, "")          // no leading dot/hyphen
  s = s.replace(/-{2,}/g, "-").replace(/-+$/, "")
  return s
}

/**
 * Resolve the current developer slug for log routing.
 * Order: KB_DEV env override → git config user.name → "unknown".
 */
export function resolveDevSlug(opts: { gitUserName?: () => string | null } = {}): string {
  const env = process.env.KB_DEV?.trim()
  if (env) {
    const s = slugifyDev(env)
    if (s) return s
  }
  const name = (opts.gitUserName ?? readGitUserName)()
  if (name) {
    const s = slugifyDev(name)
    if (s) return s
  }
  return "unknown"
}

/** `git config user.name`, or null when git is missing / not a repo / unset. */
export function readGitUserName(): string | null {
  try {
    const p = spawnSync("git", ["config", "user.name"], { encoding: "utf8" }) // argv form — no shell
    if (p.status === 0) return p.stdout.trim() || null
  } catch {
    /* fall through */
  }
  return null
}

// ─── Portable file helpers (Node + Bun) ───────────────────

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8")
}

/** Write text, creating parent directories (matches the old Bun.write behaviour). */
export async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}

/**
 * True when the module at `importMetaUrl` is the process entry point — a portable
 * stand-in for Bun's import.meta.main (absent on Node < 24.2).
 */
export function isDirectRun(importMetaUrl: string): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return resolve(entry) === fileURLToPath(importMetaUrl)
  } catch {
    return false
  }
}

// ─── Wiki File Operations ─────────────────────────────────

/**
 * Read all wiki pages and return as { path, relativePath, content } objects.
 * Skips summaries/ by default — pass { includeSummaries: true } to include it
 * (needed for source-coverage checks and the index's Sources section).
 */
export async function readAllWikiPages(
  opts: { includeSummaries?: boolean } = {},
): Promise<Array<{ path: string; relativePath: string; content: string }>> {
  const results: Array<{ path: string; relativePath: string; content: string }> = []

  async function walk(dir: string) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return
    }
    for (const name of names) {
      const fullPath = resolve(dir, name)
      const s = await stat(fullPath)
      if (s.isDirectory() && (name !== "summaries" || opts.includeSummaries)) {
        await walk(fullPath)
      } else if (s.isFile() && name.endsWith(".md")) {
        results.push({
          path: fullPath,
          relativePath: relative(config.kb.wiki, fullPath),
          content: await readText(fullPath),
        })
      }
    }
  }

  await walk(config.kb.wiki)
  return results
}

/**
 * List source files in kb/raw/sources/ (any extension, recursive).
 * Returns paths relative to kb/raw/sources/.
 */
export async function listRawSourceFiles(): Promise<string[]> {
  const results: string[] = []

  async function walk(dir: string) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name.startsWith(".")) continue
      const fullPath = resolve(dir, name)
      const s = await stat(fullPath)
      if (s.isDirectory()) {
        await walk(fullPath)
      } else if (s.isFile()) {
        results.push(relative(config.kb.rawSources, fullPath))
      }
    }
  }

  await walk(config.kb.rawSources)
  return results
}

/**
 * Read text-like raw source files for content scanning (e.g. injection-marker lint).
 * Only .md/.markdown/.mdx/.txt are read — binary/large formats (PDF, images, …) are
 * scanned only after Ingest converts them to markdown, which lands here as a new file.
 * Returns paths relative to kb/raw/sources/.
 */
export async function readRawTextSources(): Promise<
  Array<{ relativePath: string; content: string }>
> {
  const TEXT_EXT = /\.(md|markdown|mdx|txt)$/i
  const results: Array<{ relativePath: string; content: string }> = []

  async function walk(dir: string) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name.startsWith(".")) continue
      const fullPath = resolve(dir, name)
      const s = await stat(fullPath)
      if (s.isDirectory()) {
        await walk(fullPath)
      } else if (s.isFile() && TEXT_EXT.test(name)) {
        results.push({
          relativePath: relative(config.kb.rawSources, fullPath),
          content: await readText(fullPath),
        })
      }
    }
  }

  await walk(config.kb.rawSources)
  return results
}

/**
 * Write a log entry to the correct file, creating it with a header if new.
 * Pure routing is delegated to pickLogTarget; this wires the filesystem.
 * Returns the path written.
 */
export async function writeLogEntry(opts: {
  logDir: string
  legacyLog: string
  dev: string
  entry: string
}): Promise<string> {
  const { logDir, legacyLog, dev, entry } = opts
  const logDirExists = existsSync(logDir)
  const target = pickLogTarget({
    logDir,
    legacyLog,
    dev,
    logDirExists,
    legacyLogExists: existsSync(legacyLog),
    devFileExists: logDirExists && existsSync(resolve(logDir, `${dev}.md`)),
  })
  const existing = target.isNew ? logHeader(dev) : await readText(target.path)
  await writeText(target.path, insertNewestAtTop(existing, entry))
  return target.path
}

/**
 * Append an activity entry to the current developer's log file.
 * Routes to kb/wiki/log/<dev>.md (new layout) or kb/wiki/log.md (legacy).
 */
export async function appendLog(
  action: string,
  description: string,
  details: string[],
): Promise<void> {
  await writeLogEntry({
    logDir: config.kb.logDir,
    legacyLog: config.kb.legacyLog,
    dev: resolveDevSlug(),
    entry: formatLogEntry(action, description, details),
  })
}

// ─── Formatting ───────────────────────────────────────────

/**
 * Local calendar date (YYYY-MM-DD) — deliberately not UTC: toISOString() gave a
 * UTC+8 developer yesterday's date on anything logged before 08:00 local.
 */
export function todayDate(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ─── Log routing (pure) ───────────────────────────────────

/** True for the legacy single log file or any per-developer log file. */
export function isLogFile(relativePath: string): boolean {
  return relativePath === "log.md" || relativePath.startsWith("log/")
}

/** Header written when a developer's log file is first created. */
export function logHeader(dev: string): string {
  return [
    `# Wiki — Log (${dev})`,
    "",
    "> Append-only. Newest entries at top. One log file per developer.",
    "",
    "---",
    "",
  ].join("\n")
}

/** Format a single dated log entry block. */
export function formatLogEntry(
  action: string,
  description: string,
  details: string[],
): string {
  const date = todayDate()
  return [
    "",
    `## [${date}] ${action} | ${description}`,
    ...details.map((d) => `- ${d}`),
    "",
  ].join("\n")
}

/** Insert an entry right below the first `---` separator (newest at top). */
export function insertNewestAtTop(existing: string, entry: string): string {
  const firstSep = existing.indexOf("---\n")
  const insertPoint = firstSep !== -1 ? firstSep + 4 : existing.length
  return existing.slice(0, insertPoint) + entry + existing.slice(insertPoint)
}

/**
 * Decide which log file an entry goes to, given on-disk existence flags.
 * - new layout (log/ dir present) → log/<dev>.md
 * - legacy project (only log.md)  → log.md  (compat until Migrate)
 * - neither                       → adopt new layout (log/<dev>.md)
 */
export function pickLogTarget(opts: {
  logDir: string
  legacyLog: string
  dev: string
  logDirExists: boolean
  legacyLogExists: boolean
  devFileExists: boolean
}): { path: string; isNew: boolean } {
  const { logDir, legacyLog, dev, logDirExists, legacyLogExists, devFileExists } = opts
  if (logDirExists) {
    return { path: resolve(logDir, `${dev}.md`), isNew: !devFileExists }
  }
  if (legacyLogExists) {
    return { path: legacyLog, isNew: false }
  }
  return { path: resolve(logDir, `${dev}.md`), isNew: true }
}
