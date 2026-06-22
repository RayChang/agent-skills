import { test, expect } from "bun:test"
import { slugifyDev, resolveDevSlug } from "./kb"

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
