import { resolve } from "path"
import { test, expect } from "bun:test"
import {
  slugifyDev, resolveDevSlug, isLogFile, pickLogTarget, insertNewestAtTop, logHeader, formatLogEntry,
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

test("resolveDevSlug: KB_DEV overrides and is slugged", () => {
  const prev = process.env.KB_DEV
  process.env.KB_DEV = "Alice Example"
  expect(resolveDevSlug()).toBe("alice-example")
  if (prev === undefined) delete process.env.KB_DEV
  else process.env.KB_DEV = prev
})

test("resolveDevSlug: empty KB_DEV falls through to git name (non-empty, not unknown)", () => {
  const prev = process.env.KB_DEV
  delete process.env.KB_DEV
  const got = resolveDevSlug()
  expect(got.length).toBeGreaterThan(0)
  expect(got).not.toBe("unknown") // git user.name is configured in this repo
  if (prev !== undefined) process.env.KB_DEV = prev
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

test("formatLogEntry: renders dated action heading + bullets", () => {
  const e = formatLogEntry("map", "Rebuilt index", ["Pages indexed: 3"])
  expect(e).toMatch(/## \[\d{4}-\d{2}-\d{2}\] map \| Rebuilt index/)
  expect(e).toContain("- Pages indexed: 3")
})
