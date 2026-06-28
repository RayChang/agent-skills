import { test, expect } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, readFile } from "fs/promises"
import { tmpdir } from "os"
import { resolve, join } from "path"

// End-to-end guard for curated-summary preservation: seed a fixture KB whose index.md
// holds hand-curated one-liners (richer than the page bodies) plus a page that is NOT yet
// in the index, then run the real map.ts as a subprocess and inspect the rebuilt index.
// The pure parse/resolve logic is unit-tested in map.test.ts; this proves the wiring.

const scriptsDir = import.meta.dir
const mapPath = resolve(scriptsDir, "map.ts")

// map.ts statically imports @anthropic-ai/sdk, which a clean checkout auto-installs only on
// a direct run (bun resolves it at runtime, not via a static node_modules lookup). Probe
// the way the real subprocess does — an actual import — and skip when it can't be obtained
// so the suite stays green offline/SDK-less. The core logic is covered hermetically in
// map.test.ts; this file only adds end-to-end wiring confidence when the SDK is present.
let sdkAvailable = false
try {
  const probe = Bun.spawnSync(["bun", "-e", "await import('@anthropic-ai/sdk')"], {
    stdout: "ignore",
    stderr: "ignore",
  })
  sdkAvailable = probe.exitCode === 0
} catch {
  sdkAvailable = false
}

const CURATED_WIDGET = "A richly curated widget summary that must survive a rebuild."
const CURATED_SRC = "Curated source takeaway worth keeping."

async function seedFixture(d: string): Promise<void> {
  await mkdir(join(d, "kb/wiki/concepts"), { recursive: true })
  await mkdir(join(d, "kb/wiki/summaries"), { recursive: true })
  await writeFile(
    join(d, "kb/wiki/index.md"),
    `# fix Wiki — Index\n\n> Auto-maintained by \`kb:map\`. Last updated: 2026-01-01\n\n---\n\n## Concepts (1)\n- [[concepts/widget]] — ${CURATED_WIDGET}\n\n## Sources (1)\n- [[summaries/src-a]] — ${CURATED_SRC}\n\n---\n**Total: 1 pages**\n`,
  )
  // Page IS in the index, but its frontmatter summary and body differ from the curated line.
  await writeFile(
    join(d, "kb/wiki/concepts/widget.md"),
    `---\ntitle: Widget\nsummary: Frontmatter summary DIFFERENT from the curated index line.\ncategory: concepts\ntags: [a]\n---\n\n# Widget\n\nBody paragraph long enough to be picked by the fallback heuristic too.\n`,
  )
  // Page is NOT in the index — map must add it with an extracted fallback summary.
  await writeFile(
    join(d, "kb/wiki/concepts/newpage.md"),
    `---\ntitle: New Page\ncategory: concepts\ntags: [b]\n---\n\n# New Page\n\nThis brand-new page has no curated index entry yet so map extracts this paragraph.\n`,
  )
  await writeFile(
    join(d, "kb/wiki/summaries/src-a.md"),
    `---\nsource: src-a.md\norigin: external\ningested: 2026-01-01\ntags: [a]\n---\n\n- Some raw body takeaway bullet that differs from the curated source line.\n`,
  )
}

async function runMap(d: string, args: string[] = []): Promise<string> {
  const proc = Bun.spawn(["bun", mapPath, ...args], { cwd: d, stdout: "pipe", stderr: "pipe" })
  const exit = await proc.exited
  if (exit !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`map.ts exited ${exit}: ${stderr}`)
  }
  return readFile(join(d, "kb/wiki/index.md"), "utf8")
}

test.skipIf(!sdkAvailable)(
  "map (default) preserves curated summaries byte-for-byte and adds missing pages",
  async () => {
    const d = await mkdtemp(join(tmpdir(), "kbmap-"))
    try {
      await seedFixture(d)
      const index = await runMap(d)
      // Curated one-liners survive untouched — neither the frontmatter summary nor the body wins.
      expect(index).toContain(`- [[concepts/widget]] — ${CURATED_WIDGET}`)
      expect(index).toContain(`- [[summaries/src-a]] — ${CURATED_SRC}`)
      // The page missing from the index is added, with an extracted fallback summary.
      expect(index).toContain(
        "- [[concepts/newpage]] — This brand-new page has no curated index entry",
      )
      // Category counts are rebuilt to reflect what is on disk.
      expect(index).toContain("## Concepts (2)")
    } finally {
      await rm(d, { recursive: true, force: true })
    }
  },
)

test.skipIf(!sdkAvailable)(
  "map --regen-summaries re-extracts every summary from page bodies",
  async () => {
    const d = await mkdtemp(join(tmpdir(), "kbmap-"))
    try {
      await seedFixture(d)
      const index = await runMap(d, ["--regen-summaries"])
      // Curated lines are deliberately discarded in favour of fresh extraction.
      expect(index).toContain(
        "- [[concepts/widget]] — Frontmatter summary DIFFERENT from the curated index line.",
      )
      expect(index).toContain(
        "- [[summaries/src-a]] — Some raw body takeaway bullet that differs from the curated source line.",
      )
      expect(index).not.toContain(CURATED_WIDGET)
    } finally {
      await rm(d, { recursive: true, force: true })
    }
  },
)
