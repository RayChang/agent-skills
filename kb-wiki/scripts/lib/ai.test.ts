import { test, expect, afterEach } from "bun:test"
import Anthropic from "@anthropic-ai/sdk"
import { ask, askJson, classifyError, AiError, setClientForTests } from "./ai"
import { positiveIntEnv, effortEnv, config } from "./config"

// ─── Fake client ─────────────────────────────────────────

type Captured = { params: Anthropic.MessageStreamParams | null }

function fakeMessage(over: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: '{"ok":true}', citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5 } as Anthropic.Usage,
    ...over,
  } as Anthropic.Message
}

/** Install a client whose messages.stream() resolves/rejects as instructed; returns captured params. */
function installFake(result: Anthropic.Message | Error): Captured {
  const captured: Captured = { params: null }
  const fake = {
    messages: {
      stream(params: Anthropic.MessageStreamParams) {
        captured.params = params
        return {
          finalMessage: () =>
            result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
        }
      },
    },
  } as unknown as Anthropic
  setClientForTests(fake)
  return captured
}

afterEach(() => setClientForTests(null))

// ─── ask: request shape ──────────────────────────────────

test("ask: sends adaptive thinking, effort, model override, and no budget_tokens", async () => {
  const cap = installFake(fakeMessage())
  await ask("hi", { system: "sys", model: "claude-opus-5", maxTokens: 123 })
  const p = cap.params!
  expect(p.model).toBe("claude-opus-5")
  expect(p.max_tokens).toBe(123)
  expect(p.thinking).toEqual({ type: "adaptive" })
  expect(p.output_config?.effort).toBe(config.ai.effort)
  expect(p.output_config?.format).toBeUndefined()
  expect(p.system).toBe("sys")
  expect(JSON.stringify(p)).not.toContain("budget_tokens")
})

test("ask: defaults to config.ai.model and config.ai.maxTokens", async () => {
  const cap = installFake(fakeMessage())
  await ask("hi")
  expect(cap.params!.model).toBe(config.ai.model)
  expect(cap.params!.max_tokens).toBe(config.ai.maxTokens)
})

test("ask: joins text blocks and ignores thinking blocks; reports usage", async () => {
  installFake(
    fakeMessage({
      content: [
        { type: "thinking", thinking: "", signature: "" } as Anthropic.ThinkingBlock,
        { type: "text", text: "a", citations: null },
        { type: "text", text: "b", citations: null },
      ],
    }),
  )
  const r = await ask("hi")
  expect(r.content).toBe("a\nb")
  expect(r.inputTokens).toBe(10)
  expect(r.outputTokens).toBe(5)
})

// ─── ask: stop_reason handling ───────────────────────────

test("ask: stop_reason=max_tokens is an error, not a silent partial result", async () => {
  // Regression: 4096-token deep analyses were truncated and reported as complete.
  installFake(fakeMessage({ stop_reason: "max_tokens" }))
  await expect(ask("hi", { maxTokens: 50 })).rejects.toThrow(/max_tokens=50.*KB_MAX_TOKENS/)
})

test("ask: stop_reason=refusal surfaces the category", async () => {
  installFake(
    fakeMessage({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: null } as Anthropic.RefusalStopDetails,
    }),
  )
  await expect(ask("hi")).rejects.toThrow(/refusal.*cyber/)
})

// ─── askJson: structured outputs ─────────────────────────

test("askJson: passes the schema as output_config.format and parses the JSON", async () => {
  const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }
  const cap = installFake(fakeMessage())
  const r = await askJson<{ ok: boolean }>("hi", { schema })
  expect(cap.params!.output_config?.format).toEqual({ type: "json_schema", schema })
  expect(r.data).toEqual({ ok: true })
})

test("askJson: non-JSON payload reports a retryable error with a snippet", async () => {
  installFake(fakeMessage({ content: [{ type: "text", text: "Sorry, no JSON here", citations: null }] }))
  try {
    await askJson("hi", { schema: { type: "object" } })
    throw new Error("unreachable")
  } catch (e) {
    expect(e).toBeInstanceOf(AiError)
    expect((e as AiError).retryable).toBe(true)
    expect((e as AiError).message).toContain("Sorry, no JSON")
  }
})

// ─── Error classification ────────────────────────────────

function apiErr(cls: any, status: number, msg = "boom") {
  return new cls(status, { error: { message: msg } }, msg, new Headers())
}

test("classifyError: 429 / 5xx / network are retryable", () => {
  expect(classifyError(apiErr(Anthropic.RateLimitError, 429)).retryable).toBe(true)
  expect(classifyError(apiErr(Anthropic.InternalServerError, 503)).retryable).toBe(true)
  expect(classifyError(new Anthropic.APIConnectionError({ message: "ECONNRESET" })).retryable).toBe(true)
})

test("classifyError: 400 / 401 / 404 are not retryable and name the fix", () => {
  const bad = classifyError(apiErr(Anthropic.BadRequestError, 400, "budget_tokens not supported"))
  expect(bad.retryable).toBe(false)
  expect(bad.message).toContain("budget_tokens not supported")
  expect(classifyError(apiErr(Anthropic.AuthenticationError, 401)).message).toContain("ANTHROPIC_API_KEY")
  expect(classifyError(apiErr(Anthropic.NotFoundError, 404)).message).toContain("KB_MODEL")
})

test("classifyError: missing-credentials SDK error names the env var (was 'Unexpected error')", () => {
  const e = classifyError(
    new Anthropic.AnthropicError("Could not resolve authentication method. Expected one of apiKey, authToken..."),
  )
  expect(e.retryable).toBe(false)
  expect(e.message).toContain("ANTHROPIC_API_KEY")
})

test("ask: SDK exceptions are rethrown as classified AiError", async () => {
  installFake(apiErr(Anthropic.RateLimitError, 429))
  try {
    await ask("hi")
    throw new Error("unreachable")
  } catch (e) {
    expect(e).toBeInstanceOf(AiError)
    expect((e as AiError).status).toBe(429)
  }
})

// ─── config env parsing ──────────────────────────────────

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

test("effortEnv: accepts the API enum only", () => {
  withEnv("KB_TEST_EFFORT", "xhigh", () => expect(effortEnv("KB_TEST_EFFORT", "high")).toBe("xhigh"))
  withEnv("KB_TEST_EFFORT", "turbo", () => expect(effortEnv("KB_TEST_EFFORT", "high")).toBe("high"))
  withEnv("KB_TEST_EFFORT", undefined, () => expect(effortEnv("KB_TEST_EFFORT", "medium")).toBe("medium"))
})
