import { resolve } from "path"
import { test, expect, afterEach, spyOn } from "bun:test"
import { mkdir, rm } from "fs/promises"
import {
  slugifyDev, resolveDevSlug, isLogFile, pickLogTarget, insertNewestAtTop, logHeader, formatLogEntry,
  writeLogEntry,
} from "./kb"

test("slugifyDev: spaces and case → kebab", () => {
  expect(slugifyDev("Ray Chang")).toBe("ray-chang")
  expect(slugifyDev("  Multiple   Spaces  ")).toBe("multiple-spaces")
})

test("slugifyDev: strips path separators and traversal", () => {
  expect(slugifyDev("a/b")).toBe("a-b")
  expect(slugifyDev("../../etc")).toBe("etc") // no slash, no ".."
  expect(slugifyDev("..")).toBe("")
})

test("slugifyDev: preserves unicode letters", () => {
  expect(slugifyDev("張瑞")).toBe("張瑞")
})

test("slugifyDev: collapses backslash separators", () => {
  expect(slugifyDev("a\\b")).toBe("a-b")
})

// Run fn with process.env[key] set (or deleted), always restoring afterward.
function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  try {
    fn()
  } finally {
    if (prev === undefined) delete process.env[key]
    else process.env[key] = prev
  }
}

// Fake a `git config user.name` result; restores the real Bun.spawnSync afterward.
function withGitName(stdout: string, exitCode: number, fn: () => void) {
  const spy = spyOn(Bun, "spawnSync").mockReturnValue({
    exitCode,
    stdout: Buffer.from(stdout),
  } as any)
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
}

test("resolveDevSlug: KB_DEV overrides and is slugged", () => {
  withEnv("KB_DEV", "Alice Example", () => {
    expect(resolveDevSlug()).toBe("alice-example")
  })
})

test("resolveDevSlug: empty KB_DEV falls through to git name (non-empty, not unknown)", () => {
  withEnv("KB_DEV", undefined, () => {
    const got = resolveDevSlug()
    expect(got.length).toBeGreaterThan(0)
    expect(got).not.toBe("unknown") // git user.name is configured in this repo
  })
})

test("resolveDevSlug: KB_DEV that slugifies to empty falls through to git", () => {
  withEnv("KB_DEV", "..", () => {
    withGitName("Git Person", 0, () => {
      expect(resolveDevSlug()).toBe("git-person")
    })
  })
})

test('resolveDevSlug: "unknown" when git returns an empty name', () => {
  withEnv("KB_DEV", undefined, () => {
    withGitName("", 0, () => {
      expect(resolveDevSlug()).toBe("unknown")
    })
  })
})

test('resolveDevSlug: "unknown" when the git invocation fails', () => {
  withEnv("KB_DEV", undefined, () => {
    const spy = spyOn(Bun, "spawnSync").mockImplementation(() => {
      throw new Error("git not found")
    })
    try {
      expect(resolveDevSlug()).toBe("unknown")
    } finally {
      spy.mockRestore()
    }
  })
})

test("isLogFile: matches log.md and log/ files, not lookalikes", () => {
  expect(isLogFile("log.md")).toBe(true)
  expect(isLogFile("log/ray-chang.md")).toBe(true)
  expect(isLogFile("log/_archive.md")).toBe(true)
  expect(isLogFile("logging.md")).toBe(false)
  expect(isLogFile("concepts/log-shipping.md")).toBe(false)
})

test("pickLogTarget: new layout writes per-dev file", () => {
  const base = { logDir: "/k/log", legacyLog: "/k/log.md", dev: "ray-chang", legacyLogExists: false }
  expect(pickLogTarget({ ...base, logDirExists: true, devFileExists: false }))
    .toEqual({ path: resolve("/k/log", "ray-chang.md"), isNew: true })
  expect(pickLogTarget({ ...base, logDirExists: true, devFileExists: true }))
    .toEqual({ path: resolve("/k/log", "ray-chang.md"), isNew: false })
})

test("pickLogTarget: legacy single-file project keeps log.md", () => {
  expect(pickLogTarget({
    logDir: "/k/log", legacyLog: "/k/log.md", dev: "ray-chang",
    logDirExists: false, legacyLogExists: true, devFileExists: false,
  })).toEqual({ path: "/k/log.md", isNew: false })
})

test("pickLogTarget: neither exists → adopt new layout", () => {
  expect(pickLogTarget({
    logDir: "/k/log", legacyLog: "/k/log.md", dev: "ray-chang",
    logDirExists: false, legacyLogExists: false, devFileExists: false,
  })).toEqual({ path: resolve("/k/log", "ray-chang.md"), isNew: true })
})

test("insertNewestAtTop: newest entry goes right below the first --- separator", () => {
  const header = logHeader("ray-chang")
  const first = formatLogEntry("ingest", "first", ["a"])
  const second = formatLogEntry("query", "second", ["b"])
  const out = insertNewestAtTop(insertNewestAtTop(header, first), second)
  expect(out.indexOf("second")).toBeLessThan(out.indexOf("first")) // newest first
  expect(out.indexOf("---")).toBeLessThan(out.indexOf("second"))   // below header
})

test("insertNewestAtTop: appends at end when no --- separator is present", () => {
  const existing = "plain text with no separator\n"
  const entry = formatLogEntry("ingest", "x", ["y"])
  expect(insertNewestAtTop(existing, entry)).toBe(existing + entry)
})

test("formatLogEntry: renders dated action heading + bullets", () => {
  const e = formatLogEntry("map", "Rebuilt index", ["Pages indexed: 3"])
  expect(e).toMatch(/## \[\d{4}-\d{2}-\d{2}\] map \| Rebuilt index/)
  expect(e).toContain("- Pages indexed: 3")
})

const TMP = resolve(import.meta.dir, "__kbtest_tmp__")
afterEach(async () => { await rm(TMP, { recursive: true, force: true }) })

test("writeLogEntry: new layout creates log/<dev>.md with header", async () => {
  await mkdir(resolve(TMP, "log"), { recursive: true })
  const path = await writeLogEntry({
    logDir: resolve(TMP, "log"),
    legacyLog: resolve(TMP, "log.md"),
    dev: "ray-chang",
    entry: formatLogEntry("ingest", "x", ["y"]),
  })
  expect(path).toBe(resolve(TMP, "log", "ray-chang.md"))
  const text = await Bun.file(path).text()
  expect(text).toContain("# Wiki — Log (ray-chang)")
  expect(text).toContain("## [")
})

test("writeLogEntry: legacy log.md keeps appending to the single file", async () => {
  await mkdir(TMP, { recursive: true })
  await Bun.write(resolve(TMP, "log.md"), logHeader("legacy"))
  const path = await writeLogEntry({
    logDir: resolve(TMP, "log"),
    legacyLog: resolve(TMP, "log.md"),
    dev: "ray-chang",
    entry: formatLogEntry("query", "z", ["w"]),
  })
  expect(path).toBe(resolve(TMP, "log.md"))
  const text = await Bun.file(path).text()
  expect(text).toContain("z") // entry landed in the legacy file
})

test("writeLogEntry: two developers get two separate files (no shared file)", async () => {
  await mkdir(resolve(TMP, "log"), { recursive: true })
  const a = await writeLogEntry({ logDir: resolve(TMP, "log"), legacyLog: resolve(TMP, "log.md"),
    dev: "alice", entry: formatLogEntry("map", "a", ["x"]) })
  const b = await writeLogEntry({ logDir: resolve(TMP, "log"), legacyLog: resolve(TMP, "log.md"),
    dev: "bob", entry: formatLogEntry("map", "b", ["y"]) })
  expect(a).toBe(resolve(TMP, "log", "alice.md"))
  expect(b).toBe(resolve(TMP, "log", "bob.md"))
  expect(a).not.toBe(b)
})

test("writeLogEntry: adopts new layout with no pre-existing dir (Bun.write auto-creates log/)", async () => {
  // No mkdir at all — neither TMP, log/, nor log.md exists beforehand.
  const path = await writeLogEntry({
    logDir: resolve(TMP, "log"),
    legacyLog: resolve(TMP, "log.md"),
    dev: "ray-chang",
    entry: formatLogEntry("ingest", "x", ["y"]),
  })
  expect(path).toBe(resolve(TMP, "log", "ray-chang.md"))
  expect(await Bun.file(path).exists()).toBe(true)
  expect(await Bun.file(path).text()).toContain("# Wiki — Log (ray-chang)")
})
