import { getAiClient, type AiClient } from "./client";
import { ASSIST_SYSTEM, buildAssistPrompt } from "./prompts";
import { assistResultSchema, toolSchemaFor, type AssistResult } from "./schemas";

/**
 * Quick-capture auto-fill.
 *
 * Suggestions only. Nothing here writes to the database — the result goes into
 * the form fields, where the teacher reads it and presses save, or does not.
 */
export async function suggestEntry(
  slovene: string,
  options: { hint?: string; client?: AiClient } = {},
): Promise<AssistResult> {
  const client = options.client ?? getAiClient();

  const response = await client.callTool({
    system: ASSIST_SYSTEM,
    prompt: buildAssistPrompt(slovene, options.hint),
    toolName: "fill_in_entry",
    toolDescription:
      "Propose the missing fields for a captured Slovene word or phrase. Suggestions, not decisions.",
    inputSchema: toolSchemaFor(assistResultSchema),
    maxTokens: 1_500,
  });

  return assistResultSchema.parse(response.data);
}
