import { readdir, stat, readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync, createReadStream } from "node:fs"
import { resolve, relative, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
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

/**
 * Read text with line endings normalised to LF. Every parser here works line by line
 * and a regex `.` never matches `\r`, so a file an editor saved as CRLF would otherwise
 * parse as empty — for index.md that means a Map rebuild discarding every curated
 * one-liner.
 */
export async function readText(path: string): Promise<string> {
  return (await readFile(path, "utf8")).replace(/\r\n/g, "\n")
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
 * SHA-256 of the named raw source files (paths relative to kb/raw/sources/). Hashes
 * bytes, not decoded text, so it covers binary sources and matches `shasum -a 256` /
 * `sha256sum` — the value Ingest records in a summary's `sha256` field.
 *
 * Only the files asked for are read, and each is streamed: a KB whose summaries record
 * no hash (every KB that predates the field) reads nothing, and a multi-GB PDF never
 * sits in memory. A file that cannot be read maps to its error code (EACCES, ENOENT, …)
 * — an unreadable or vanished source is a finding for the caller to report, never a
 * reason to abort the whole lint.
 */
export async function hashRawSources(relPaths: Iterable<string>): Promise<Map<string, RawHash>> {
  const hashes = new Map<string, RawHash>()
  for (const rel of new Set(relPaths)) {
    try {
      const hash = createHash("sha256")
      for await (const chunk of createReadStream(resolve(config.kb.rawSources, rel))) hash.update(chunk)
      hashes.set(rel, { sha256: hash.digest("hex") })
    } catch (err) {
      hashes.set(rel, { error: (err as { code?: string }).code ?? "unreadable" })
    }
  }
  return hashes
}

/** Current state of one raw file: its hash, or the error code that stopped it being read. */
export type RawHash = { sha256: string } | { error: string }

/** Line count as `wc -l` reports it for newline-terminated text (a final newline adds no line). */
export function lineCount(text: string): number {
  if (text === "") return 0
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
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

// ─── Frontmatter (shared by lint and map — one parser, so they cannot disagree) ───

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/

/** Frontmatter block of a page with line endings normalised to LF; "" when absent. */
export function frontmatterOf(content: string): string {
  return content.match(FRONTMATTER)?.[1].replace(/\r/g, "") ?? ""
}

/** The page text after its frontmatter block — the whole text when it has none. */
export function bodyOf(content: string): string {
  const m = content.match(FRONTMATTER)
  return m ? content.slice(m[0].length) : content
}

/**
 * A YAML scalar as written: a trailing ` # comment` dropped, and a quoted value
 * unquoted. The schema's own examples annotate fields with comments
 * (`sha256: <hex>   # optional — …`), so a value copied from them must still compare equal.
 *
 * A value counts as quoted only when its closing quote ends it — escapes honoured
 * (`\"` inside double quotes, `''` inside single quotes). Anything else is kept as
 * written, quotes included: a real page titled `"Merged" does not equal "landed" — …`
 * is not valid YAML, and reading it as the quoted scalar `Merged` would throw away the
 * rest of the title.
 *
 * For the same reason an unquoted `#` starts a comment only when whitespace follows it
 * (`# note`). Strict YAML would also cut `Fix for bug #42` down to `Fix for bug`; titles
 * and summaries are prose, where `#42` is a reference, so it is kept.
 */
function yamlScalar(raw: string): string {
  const v = raw.trim()
  const double = v.match(/^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/)
  if (double) return double[1].replace(/\\(["\\])/g, "$1")
  const single = v.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/)
  if (single) return single[1].replace(/''/g, "'")
  return v.replace(/(^|\s+)#(\s.*)?$/, "").trim()
}

/** Scalar frontmatter value; null when the key is absent or its value is empty. */
export function fmValue(fm: string, key: string): string | null {
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"))
  return (m && yamlScalar(m[1])) || null
}

/** Tags from frontmatter — inline `[a, b]` or a YAML block list; trailing comments ignored. */
export function parseTags(fm: string): string[] {
  const inline = fm.match(/^tags:[ \t]*\[([^\]]*)\]/m)
  if (inline) return inline[1].split(",").map(yamlScalar).filter(Boolean)
  // Items may be indented or not — `tags:\n- a\n- b` is valid YAML and what many
  // editors emit. The run ends at the first line that is not a `- item`.
  const block = fm.match(/^tags:[ \t]*(?:#.*)?\n((?:[ \t]*-(?:[ \t].*)?(?:\n|$))+)/m)
  if (!block) return []
  return block[1]
    .split("\n")
    .map((l) => yamlScalar(l.replace(/^[ \t]*-[ \t]*/, "")))
    .filter(Boolean)
}

// ─── index.md parsing (pure) ──────────────────────────────

// One index entry: `- [[slug]] — summary` (Overview, category, and Sources lines all
// share this shape). The slug may carry an optional `|Display` alias. The separator is
// the em-dash with single surrounding spaces, exactly as map's buildIndex emits it; we
// split on the FIRST such separator so a summary may itself contain " — ".
const INDEX_ENTRY = /^- \[\[([^\]|]+)(?:\|[^\]]*)?\]\] — (.+)$/

/**
 * Parse an existing index.md into a `slug -> summary` map. The one-liner in index.md is
 * human-owned content (often hand-curated and richer than a page's opening sentence), so
 * a rebuild harvests these to preserve them rather than re-flattening from page bodies.
 * First occurrence of a slug wins; non-entry lines (headings, separators, prose) are
 * ignored. Returns an empty map for empty/absent content (first-run safety).
 */
export function parseIndexSummaries(indexContent: string): Map<string, string> {
  const summaries = new Map<string, string>()
  for (const line of indexContent.split(/\r?\n/)) {
    const m = line.match(INDEX_ENTRY)
    if (m && !summaries.has(m[1])) summaries.set(m[1], m[2])
  }
  return summaries
}

/**
 * What index.md costs to read. Every operation reads it first, so its size is the KB's
 * fixed per-operation overhead — and that is driven by one-liner length, not line count.
 * `long` lists entries over `oneLinerMaxChars`, longest first. Shared by map's Stats
 * block and lint's index-size check.
 */
export function indexStats(
  indexContent: string,
  oneLinerMaxChars: number,
): { bytes: number; lines: number; entries: number; long: Array<{ slug: string; chars: number }> } {
  const entries = [...parseIndexSummaries(indexContent)].map(([slug, summary]) => ({
    slug,
    chars: summary.length,
  }))
  return {
    bytes: Buffer.byteLength(indexContent, "utf8"),
    lines: lineCount(indexContent),
    entries: entries.length,
    long: entries.filter((e) => e.chars > oneLinerMaxChars).sort((a, b) => b.chars - a.chars),
  }
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
