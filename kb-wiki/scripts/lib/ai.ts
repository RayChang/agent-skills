import Anthropic from "@anthropic-ai/sdk"
import { config } from "./config"

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic()
  }
  return client
}

export interface AiResponse {
  content: string
  inputTokens: number
  outputTokens: number
}

export async function ask(
  prompt: string,
  options?: { system?: string; maxTokens?: number },
): Promise<AiResponse> {
  const response = await getClient().messages.create({
    model: config.ai.model,
    max_tokens: options?.maxTokens ?? config.ai.maxTokens,
    ...(options?.system ? { system: options.system } : {}),
    messages: [{ role: "user", content: prompt }],
  })

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
 * Extract and parse the JSON payload of an LLM response (optionally inside a ``` fence).
 * Throws an actionable error instead of a raw SyntaxError: by the time parsing fails
 * the API call has already been paid for, so the message must tell the user what came
 * back and what to do — not just where JSON.parse choked.
 */
export function parseJsonResponse<T = unknown>(content: string): T {
  let jsonStr = content.trim()
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenceMatch) jsonStr = fenceMatch[1].trim()

  try {
    return JSON.parse(jsonStr) as T
  } catch (err) {
    const snippet = jsonStr.slice(0, 200).replace(/\s+/g, " ")
    throw new Error(
      `LLM response is not valid JSON (${(err as Error).message}). ` +
        `Response starts with: "${snippet}". The API call itself succeeded — ` +
        "re-run the command; if this persists, adjust KB_MODEL or the prompt.",
    )
  }
}

export async function askJson<T = unknown>(
  prompt: string,
  options?: { system?: string; maxTokens?: number },
): Promise<{ data: T; inputTokens: number; outputTokens: number }> {
  const response = await ask(prompt, options)

  return {
    data: parseJsonResponse<T>(response.content),
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  }
}
