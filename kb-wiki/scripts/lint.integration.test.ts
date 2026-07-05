import { test, expect } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, cp } from "fs/promises"
import { existsSync } from "fs"
import { tmpdir } from "os"
import { resolve, join, dirname } from "path"

// Subprocess-level guards for lint.ts (and the shared missing-KB guard on map.ts):
// the pure check functions are unit-tested in lint.test.ts; these prove the wiring.

const scriptsDir = import.meta.dir
const lintPath = resolve(scriptsDir, "lint.ts")
const mapPath = resolve(scriptsDir, "map.ts")

async function run(script: string, cwd: string, args: string[] = []) {
  const proc = Bun.spawn(["bun", script, ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const exitCode = await proc.exited
  return {
    exitCode,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  }
}

// ─── Missing-KB guard: never scaffold a junk KB in a wrong cwd ──────────────

test("lint refuses to run where no kb/wiki exists and creates nothing", async () => {
  const d = await mkdtemp(join(tmpdir(), "kbguard-"))
  try {
    const { exitCode, stderr } = await run(lintPath, d)
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain("No KB found")
    expect(existsSync(join(d, "kb"))).toBe(false)
  } finally {
    await rm(d, { recursive: true, force: true })
  }
})

test("map refuses to run where no kb/wiki exists and creates nothing", async () => {
  const d = await mkdtemp(join(tmpdir(), "kbguard-"))
  try {
    const { exitCode, stderr } = await run(mapPath, d)
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain("No KB found")
    expect(existsSync(join(d, "kb"))).toBe(false)
  } finally {
    await rm(d, { recursive: true, force: true })
  }
})

// ─── Empty-category detection ───────────────────────────────────────────────

test("empty category dir and a _moc-only category are both flagged", async () => {
  const d = await mkdtemp(join(tmpdir(), "kblint-"))
  try {
    await mkdir(join(d, "kb/wiki/concepts"), { recursive: true })
    await mkdir(join(d, "kb/wiki/emptycat"), { recursive: true })
    await mkdir(join(d, "kb/wiki/moconly"), { recursive: true })
    await writeFile(
      join(d, "kb/wiki/concepts/x.md"),
      `---\ntitle: X\ncategory: concepts\ntags: [a]\n---\n\n# X\n\nBody long enough to be a summary for this page in the fixture KB here.\n`,
    )
    // A category whose pages were all deleted, leaving only the generated MOC behind
    await writeFile(join(d, "kb/wiki/moconly/_moc.md"), "# Moconly — Map of Content\n")
    const { exitCode, stdout } = await run(lintPath, d)
    expect(exitCode).toBe(0)
    expect(stdout).toContain(`Category "emptycat" has no pages`)
    expect(stdout).toContain(`Category "moconly" has no pages`)
    expect(stdout).not.toContain(`Category "concepts" has no pages`)
  } finally {
    await rm(d, { recursive: true, force: true })
  }
})

// ─── Structural lint must run with @anthropic-ai/sdk ABSENT ─────────────────
// lint.ts used to import ./lib/ai (→ @anthropic-ai/sdk) at the top level, so even
// structural checks crashed at launch when the SDK could not resolve — the exact bug
// class already fixed for map.ts. Same isolation recipe as map.integration.test.ts.

async function runNoSdk(projectDir: string, args: string[] = []) {
  const skillDir = await mkdtemp(join(tmpdir(), "kbskill-"))
  const cacheDir = await mkdtemp(join(tmpdir(), "kbcache-")) // empty → SDK not in cache
  try {
    await cp(dirname(lintPath), join(skillDir, "scripts"), { recursive: true })
    await writeFile(join(projectDir, "bunfig.toml"), `[install]\nauto = "disable"\n`)
    const proc = Bun.spawn(["bun", join(skillDir, "scripts", "lint.ts"), ...args], {
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

async function seedMinimalKb(d: string) {
  await mkdir(join(d, "kb/wiki/concepts"), { recursive: true })
  await writeFile(
    join(d, "kb/wiki/concepts/x.md"),
    `---\ntitle: X\ncategory: concepts\ntags: [a]\n---\n\n# X\n\nBody long enough to be a summary for this page in the fixture KB here.\n`,
  )
}

test("lint (structural) runs with @anthropic-ai/sdk absent", async () => {
  const d = await mkdtemp(join(tmpdir(), "kblint-"))
  try {
    await seedMinimalKb(d)
    const { exitCode, stderr } = await runNoSdk(d)
    expect(stderr).not.toContain("Cannot find module")
    expect(exitCode).toBe(0)
    expect(existsSync(join(d, "kb/wiki"))).toBe(true)
  } finally {
    await rm(d, { recursive: true, force: true })
  }
})

test("lint --deep with the SDK absent fails actionably after completing structural checks", async () => {
  const d = await mkdtemp(join(tmpdir(), "kblint-"))
  try {
    await seedMinimalKb(d)
    const { exitCode, stdout, stderr } = await runNoSdk(d, ["--deep"])
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain("@anthropic-ai/sdk")
    expect(stderr.toLowerCase()).toContain("--deep")
    // structural findings still reported despite the missing SDK
    expect(stdout).toContain("Wiki Health Check Report")
  } finally {
    await rm(d, { recursive: true, force: true })
  }
})
