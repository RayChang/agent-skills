import { readdir, stat } from "fs/promises"
import { resolve, relative } from "path"
import { config } from "./config"

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
