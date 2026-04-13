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

export async function askJson<T = unknown>(
  prompt: string,
  options?: { system?: string; maxTokens?: number },
): Promise<{ data: T; inputTokens: number; outputTokens: number }> {
  const response = await ask(prompt, options)

  let jsonStr = response.content.trim()
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenceMatch) jsonStr = fenceMatch[1].trim()

  return {
    data: JSON.parse(jsonStr) as T,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  }
}
