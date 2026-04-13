import { readdir, stat } from "fs/promises"
import { resolve, relative } from "path"
import { config } from "./config"

// ─── Wiki File Operations ─────────────────────────────────

/**
 * Read all wiki pages and return as { path, relativePath, content } objects.
 * Skips summaries/ directory.
 */
export async function readAllWikiPages(): Promise<
  Array<{ path: string; relativePath: string; content: string }>
> {
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
      if (s.isDirectory() && name !== "summaries") {
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

  // Insert after the header section (after the second ---)
  const firstSep = existing.indexOf("---\n")
  const secondSep = firstSep !== -1 ? existing.indexOf("---\n", firstSep + 1) : -1
  const insertPoint = secondSep !== -1 ? secondSep + 4 : existing.length

  const updated = existing.slice(0, insertPoint) + entry + existing.slice(insertPoint)
  await Bun.write(config.kb.log, updated)
}

// ─── Formatting ───────────────────────────────────────────

export function todayDate(): string {
  return new Date().toISOString().split("T")[0]
}
