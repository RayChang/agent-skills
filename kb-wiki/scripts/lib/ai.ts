import Anthropic from "@anthropic-ai/sdk"
import { config } from "./config.ts"

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic()
  }
  return client
}

/** Test seam: replace the SDK client (unit tests never hit the network). */
export function setClientForTests(fake: Anthropic | null): void {
  client = fake
}

export interface AiResponse {
  content: string
  inputTokens: number
  outputTokens: number
}

export interface AskOptions {
  system?: string
  maxTokens?: number
  /** Overrides config.ai.model — lint uses the heavier config.ai.lintModel. */
  model?: string
  /** JSON Schema for structured outputs. Top level must be an object (API rule). */
  schema?: Record<string, unknown>
}

/**
 * Classified API failure. `retryable` tells the caller whether re-running the command
 * is a sensible next step (429 / 5xx / network) or pointless until something is fixed
 * (400 / 401 / 403 / 404 → key, model id, or request shape).
 */
export class AiError extends Error {
  readonly retryable: boolean
  readonly status?: number
  // No TS parameter properties: Node's --experimental-strip-types rejects them.
  constructor(message: string, retryable: boolean, status?: number) {
    super(message)
    this.name = "AiError"
    this.retryable = retryable
    this.status = status
  }
}

export function classifyError(err: unknown): AiError {
  if (err instanceof AiError) return err
  // Thrown by the SDK before any request is sent when no credential source is configured.
  if (err instanceof Error && /Could not resolve authentication method/i.test(err.message)) {
    return new AiError(
      "No Anthropic credentials found. Export ANTHROPIC_API_KEY (or run `ant auth login`), then re-run --deep.",
      false,
    )
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError(
      "Authentication failed (401). Set ANTHROPIC_API_KEY or run `ant auth login`.",
      false,
      401,
    )
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AiError(`Permission denied (403): ${err.message}`, false, 403)
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AiError(
      `Not found (404) — usually an unknown model id. Check KB_MODEL / KB_LINT_MODEL: ${err.message}`,
      false,
      404,
    )
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AiError(
      `Bad request (400) — rejected request shape; retrying will not help: ${err.message}`,
      false,
      400,
    )
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError("Rate limited (429). Wait a moment and re-run the command.", true, 429)
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new AiError(`Anthropic server error (${err.status}). Re-run the command.`, true, err.status)
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError(
      `Could not reach the Anthropic API (${err.message.replace(/\.$/, "")}). Check network and re-run.`,
      true,
    )
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError(`Anthropic API error (${err.status}): ${err.message}`, false, err.status)
  }
  return new AiError(`Unexpected error: ${(err as Error)?.message ?? String(err)}`, false)
}

export async function ask(prompt: string, options?: AskOptions): Promise<AiResponse> {
  const params: Anthropic.MessageStreamParams = {
    model: options?.model ?? config.ai.model,
    max_tokens: options?.maxTokens ?? config.ai.maxTokens,
    // Adaptive thinking is the only on-mode for Sonnet 5 / Opus 5 (budget_tokens → 400).
    thinking: { type: "adaptive" },
    output_config: {
      effort: config.ai.effort,
      ...(options?.schema ? { format: { type: "json_schema", schema: options.schema } } : {}),
    },
    ...(options?.system ? { system: options.system } : {}),
    messages: [{ role: "user", content: prompt }],
  }

  let response: Anthropic.Message
  try {
    // Streaming keeps a large max_tokens off the HTTP timeout; finalMessage() assembles it.
    response = await getClient().messages.stream(params).finalMessage()
  } catch (err) {
    throw classifyError(err)
  }

  if (response.stop_reason === "max_tokens") {
    throw new AiError(
      `Response was cut off at max_tokens=${params.max_tokens} (${response.usage.output_tokens} output tokens). ` +
        "Raise KB_MAX_TOKENS and re-run — a truncated analysis is invalid, not partial.",
      false,
    )
  }
  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.type === "refusal" ? response.stop_details.category : null
    throw new AiError(
      `The model declined the request (stop_reason=refusal, category=${category ?? "n/a"}).`,
      false,
    )
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")

  return {
    content: text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  }
}

/**
 * Structured-output request: the API guarantees the text is JSON matching `schema`,
 * so parsing cannot fail on model chatter — only on a transport-level surprise, which
 * is reported with the payload snippet rather than a bare SyntaxError.
 */
export async function askJson<T = unknown>(
  prompt: string,
  options: AskOptions & { schema: Record<string, unknown> },
): Promise<{ data: T; inputTokens: number; outputTokens: number }> {
  const response = await ask(prompt, options)
  let data: T
  try {
    data = JSON.parse(response.content) as T
  } catch (err) {
    const snippet = response.content.slice(0, 200).replace(/\s+/g, " ")
    throw new AiError(
      `Structured output was not valid JSON (${(err as Error).message}). Response starts with: "${snippet}"`,
      true,
    )
  }
  return { data, inputTokens: response.inputTokens, outputTokens: response.outputTokens }
}
