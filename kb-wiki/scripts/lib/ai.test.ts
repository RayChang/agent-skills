import { test, expect, mock } from "bun:test"

// ai.ts imports @anthropic-ai/sdk at module load; parseJsonResponse is pure and needs
// no client — stub the SDK so this unit test never depends on the real module.
mock.module("@anthropic-ai/sdk", () => ({ default: class {} }))
const { parseJsonResponse } = await import("./ai")
const { positiveIntEnv } = await import("./config")

// ─── parseJsonResponse ───────────────────────────────────

test("parseJsonResponse: plain JSON", () => {
  expect(parseJsonResponse<{ a: number }>('{"a": 1}')).toEqual({ a: 1 })
})

test("parseJsonResponse: JSON inside a ``` fence with surrounding prose", () => {
  expect(parseJsonResponse('Here you go:\n```json\n[{"x": true}]\n```\n')).toEqual([{ x: true }])
})

test("parseJsonResponse: invalid JSON throws an actionable error with the response snippet", () => {
  // Regression: a bare JSON.parse crashed with a raw SyntaxError AFTER the API call
  // was already paid for, telling the user nothing about what came back.
  expect(() => parseJsonResponse("Sorry, I cannot produce JSON for this.")).toThrow(
    /not valid JSON/,
  )
  try {
    parseJsonResponse("Sorry, I cannot produce JSON for this.")
    throw new Error("unreachable")
  } catch (e) {
    expect((e as Error).message).toContain("Sorry, I cannot produce")
    expect((e as Error).message).toContain("KB_MODEL")
  }
})

// ─── positiveIntEnv ──────────────────────────────────────

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

test("positiveIntEnv: valid override wins, junk falls back", () => {
  withEnv("KB_TEST_INT", "8192", () => expect(positiveIntEnv("KB_TEST_INT", 7)).toBe(8192))
  // Regression: Number("4k") → NaN flowed straight into the API call as maxTokens.
  withEnv("KB_TEST_INT", "4k", () => expect(positiveIntEnv("KB_TEST_INT", 7)).toBe(7))
  withEnv("KB_TEST_INT", "-1", () => expect(positiveIntEnv("KB_TEST_INT", 7)).toBe(7))
  withEnv("KB_TEST_INT", "", () => expect(positiveIntEnv("KB_TEST_INT", 7)).toBe(7))
  withEnv("KB_TEST_INT", undefined, () => expect(positiveIntEnv("KB_TEST_INT", 7)).toBe(7))
})
