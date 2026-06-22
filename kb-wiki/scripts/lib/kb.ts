import { readdir, stat } from "fs/promises"
import { resolve, relative } from "path"
import { config } from "./config"

// ─── Developer identity ───────────────────────────────────

/**
 * Filename-safe slug for a developer identifier. NOT the Init shell allowlist:
 * this value only becomes a path component (Bun.write), never a shell argument,
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
export function resolveDevSlug(): string {
  const env = process.env.KB_DEV?.trim()
  if (env) {
    const s = slugifyDev(env)
    if (s) return s
  }
  try {
    const p = Bun.spawnSync(["git", "config", "user.name"]) // array form — no shell
    if (p.exitCode === 0) {
      const s = slugifyDev(p.stdout.toString().trim())
      if (s) return s
    }
  } catch {
    /* git missing / not a repo → fall through */
  }
  return "unknown"
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
          content: await Bun.file(fullPath).text(),
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
          content: await Bun.file(fullPath).text(),
        })
      }
    }
  }

  await walk(config.kb.rawSources)
  return results
}

/**
 * Append an entry to log.md (newest entries at top, below the header separator).
 */
export async function appendLog(
  action: string,
  description: string,
  details: string[],
): Promise<void> {
  const date = new Date().toISOString().split("T")[0]
  const entry = [
    "",
    `## [${date}] ${action} | ${description}`,
    ...details.map((d) => `- ${d}`),
    "",
  ].join("\n")

  const logFile = Bun.file(config.kb.log)
  const existing = await logFile.text()

  // Insert right below the header separator (first ---) — newest entries at top.
  // (The init template has exactly one --- ; searching for a second one used to
  //  silently append entries to the bottom of the file.)
  const firstSep = existing.indexOf("---\n")
  const insertPoint = firstSep !== -1 ? firstSep + 4 : existing.length

  const updated = existing.slice(0, insertPoint) + entry + existing.slice(insertPoint)
  await Bun.write(config.kb.log, updated)
}

// ─── Formatting ───────────────────────────────────────────

export function todayDate(): string {
  return new Date().toISOString().split("T")[0]
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
  const date = new Date().toISOString().split("T")[0]
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
