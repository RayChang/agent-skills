import { test, expect } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, readFile, cp } from "fs/promises"
import { tmpdir } from "os"
import { resolve, join, dirname } from "path"

// End-to-end guard for curated-summary preservation: seed a fixture KB whose index.md
// holds hand-curated one-liners (richer than the page bodies) plus a page that is NOT yet
// in the index, then run the real map.ts as a subprocess and inspect the rebuilt index.
// The pure parse/resolve logic is unit-tested in map.test.ts; this proves the wiring.

const scriptsDir = import.meta.dir
const mapPath = resolve(scriptsDir, "map.ts")

// The default (non-deep) map is deterministic and must NOT require @anthropic-ai/sdk — the
// SDK is only for the --deep LLM path. These first two tests exercise the default/regen
// behaviour with the SDK present (the common dev machine). The isolated no-SDK tests at the
// bottom are the regression guard proving the default path launches with the SDK absent.
// Probe whether the SDK resolves so the present-SDK tests skip cleanly when it doesn't.
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

// ─── Regression: default map must run with @anthropic-ai/sdk ABSENT ────────────
// The original code top-level-imported ./lib/ai (which imports @anthropic-ai/sdk), so even
// the deterministic default run crashed at launch when the SDK could not be resolved —
// `Cannot find module '@anthropic-ai/sdk'`. We reproduce a genuinely SDK-less environment:
// a copy of scripts/ with no node_modules, auto-install disabled, and an empty install
// cache, so nothing can transparently supply the SDK. The AI import must be lazy (loaded
// only inside the --deep branch) for the default run to survive this.

/** Run map.ts from an isolated copy of scripts/ where the SDK genuinely cannot resolve. */
async function runMapNoSdk(
  projectDir: string,
  args: string[] = [],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const skillDir = await mkdtemp(join(tmpdir(), "kbskill-"))
  const cacheDir = await mkdtemp(join(tmpdir(), "kbcache-")) // empty → SDK not in cache
  try {
    // Copy scripts/ (incl. lib/) but NOT node_modules / package.json — a bare script tree.
    await cp(dirname(mapPath), join(skillDir, "scripts"), { recursive: true })
    // bunfig in the cwd disables auto-install so the missing SDK can't be fetched on demand.
    await writeFile(join(projectDir, "bunfig.toml"), `[install]\nauto = "disable"\n`)
    const proc = Bun.spawn(["bun", join(skillDir, "scripts", "map.ts"), ...args], {
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, BUN_INSTALL_CACHE_DIR: cacheDir },
    })
    const exitCode = await proc.exited
    return {
      exitCode,
      stdout: await new Response(proc.stdout).text(),
      stderr: await new Response(proc.stderr).text(),
    }
  } finally {
    await rm(skillDir, { recursive: true, force: true })
    await rm(cacheDir, { recursive: true, force: true })
  }
}

test("map (default) runs with @anthropic-ai/sdk absent and preserves curated summaries", async () => {
  const d = await mkdtemp(join(tmpdir(), "kbmap-"))
  try {
    await seedFixture(d)
    const { exitCode, stderr } = await runMapNoSdk(d)
    expect(stderr).not.toContain("Cannot find module")
    expect(exitCode).toBe(0)
    const index = await readFile(join(d, "kb/wiki/index.md"), "utf8")
    expect(index).toContain(`- [[concepts/widget]] — ${CURATED_WIDGET}`)
    expect(index).toContain("## Concepts (2)")
  } finally {
    await rm(d, { recursive: true, force: true })
  }
})

test("map --deep with the SDK absent fails with an actionable message, not a raw module error", async () => {
  const d = await mkdtemp(join(tmpdir(), "kbmap-"))
  try {
    await seedFixture(d)
    const { exitCode, stderr } = await runMapNoSdk(d, ["--deep"])
    expect(exitCode).not.toBe(0)
    // Actionable: names the dep and points at the plain deterministic rebuild.
    expect(stderr).toContain("@anthropic-ai/sdk")
    expect(stderr.toLowerCase()).toContain("--deep")
  } finally {
    await rm(d, { recursive: true, force: true })
  }
})

// ─── Regression: wiki title comes from kb/schema.md, never the cwd/worktree name ──
// This project always runs inside .worktrees/<name>/, so the cwd basename is the worktree
// name — deriving the title from it wrote e.g. `# kb-test Wiki`. mkdtemp gives a random
// basename here, standing in for that wrong source; the title must instead read "FVG".

async function seedOnePage(d: string): Promise<void> {
  await mkdir(join(d, "kb/wiki/concepts"), { recursive: true })
  await writeFile(
    join(d, "kb/wiki/concepts/x.md"),
    `---\ntitle: X\ncategory: concepts\ntags: [a]\n---\n\n# X\n\nBody long enough to be the fallback summary for this page here.\n`,
  )
}

test("map titles the index from kb/schema.md, not the cwd/worktree basename", async () => {
  const d = await mkdtemp(join(tmpdir(), "kb-test-")) // basename is NOT the project name
  try {
    await seedOnePage(d)
    await writeFile(join(d, "kb/schema.md"), "# FVG Knowledge Base — Schema\n\nconventions.\n")
    const { exitCode } = await runMapNoSdk(d)
    expect(exitCode).toBe(0)
    const index = await readFile(join(d, "kb/wiki/index.md"), "utf8")
    expect(index.split("\n")[0]).toBe("# FVG Wiki — Index")
    // The temp dir basename must NOT leak into the title.
    expect(index).not.toContain(d.split("/").pop()!)
  } finally {
    await rm(d, { recursive: true, force: true })
  }
})

test("map preserves the existing index title when schema.md has no usable name", async () => {
  const d = await mkdtemp(join(tmpdir(), "kb-test-")) // again, basename != project name
  try {
    await seedOnePage(d)
    // No kb/schema.md; the existing index carries the real, human-set title.
    await writeFile(
      join(d, "kb/wiki/index.md"),
      "# FVG Wiki — Index\n\n> Auto-maintained by `kb:map`. Last updated: 2026-01-01\n\n---\n**Total: 0 pages**\n",
    )
    const { exitCode } = await runMapNoSdk(d)
    expect(exitCode).toBe(0)
    const index = await readFile(join(d, "kb/wiki/index.md"), "utf8")
    expect(index.split("\n")[0]).toBe("# FVG Wiki — Index")
    expect(index).not.toContain(d.split("/").pop()!)
  } finally {
    await rm(d, { recursive: true, force: true })
  }
})
