import { env } from "@/lib/env";

/**
 * The Anthropic client, behind an interface.
 *
 * Server-side only — the key never leaves the server, and nothing in this file
 * is importable from a client component. The interface exists so tests can run
 * the whole generation pipeline against a stub without a network call or a key.
 */

export type ToolRequest = {
  system: string;
  prompt: string;
  /** Structured output is a forced tool call: the model cannot reply in prose. */
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
};

export type ToolResponse = {
  /** The tool input, still unvalidated. Zod is the gate, not this. */
  data: unknown;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export interface AiClient {
  readonly model: string;
  callTool(request: ToolRequest): Promise<ToolResponse>;
}

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

class AnthropicClient implements AiClient {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs = 120_000,
  ) {}

  async callTool(request: ToolRequest): Promise<ToolResponse> {
    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens ?? 8_000,
          system: request.system,
          messages: [{ role: "user", content: request.prompt }],
          tools: [
            {
              name: request.toolName,
              description: request.toolDescription,
              input_schema: request.inputSchema,
            },
          ],
          tool_choice: { type: "tool", name: request.toolName },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AiUnavailableError(
        `could not reach the Anthropic API: ${(error as Error).message}`,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AiUnavailableError(
        `Anthropic API returned ${response.status}: ${body.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as {
      model?: string;
      content?: { type: string; name?: string; input?: unknown }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const toolUse = payload.content?.find(
      (block) => block.type === "tool_use" && block.name === request.toolName,
    );
    if (!toolUse) {
      throw new AiUnavailableError("the model answered without calling the tool");
    }

    return {
      data: toolUse.input,
      model: payload.model ?? this.model,
      inputTokens: payload.usage?.input_tokens ?? null,
      outputTokens: payload.usage?.output_tokens ?? null,
    };
  }
}

export function getAiClient(): AiClient {
  const key = env().ANTHROPIC_API_KEY;
  if (!key) {
    throw new AiUnavailableError("ANTHROPIC_API_KEY is not set");
  }
  return new AnthropicClient(key, env().ANTHROPIC_MODEL);
}
