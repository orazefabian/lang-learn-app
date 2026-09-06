import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { clozeItems, generationItems, generationRuns, lexemes, phrases } from "@/db/schema";
import { logger } from "@/lib/logger";
import { normalizeSlovene } from "@/lib/seed/schemas";
import { getAiClient, type AiClient } from "./client";
import { buildGenerationPrompt, GENERATION_SYSTEM } from "./prompts";
import {
  generationResultSchema,
  locateBlank,
  toolSchemaFor,
  type ProposedLexeme,
  type ProposedPhrase,
} from "./schemas";

/**
 * Generation, end to end.
 *
 * The one rule this file exists to enforce: everything it writes lands as a
 * draft. There is no code path here that produces an active item or a card.
 * Approval is a separate, deliberate act by the teacher, in review.ts.
 */

export type GenerateInput = {
  topic: string;
  instructions?: string;
  kind: "mixed" | "phrases" | "lexemes" | "cloze";
  count: number;
};

export type RunSummary = {
  runId: string;
  proposed: number;
  drafted: number;
  duplicates: number;
  /** Things that did not survive validation, in plain German-facing terms. */
  warnings: string[];
  modelNotes: string | null;
};

const TOOL_NAME = "propose_content";
const TOOL_DESCRIPTION =
  "Propose Slovene learning material for review. Everything you propose is checked by a native speaker before the learner sees it.";

export class GenerationFailedError extends Error {
  constructor(
    message: string,
    readonly runId: string,
  ) {
    super(message);
    this.name = "GenerationFailedError";
  }
}

export async function generateDrafts(
  db: Db,
  options: { requestedBy: string; input: GenerateInput; client?: AiClient },
): Promise<RunSummary> {
  const client = options.client ?? getAiClient();
  const { input } = options;

  const [run] = await db
    .insert(generationRuns)
    .values({
      requestedBy: options.requestedBy,
      topic: input.topic,
      instructions: input.instructions ?? null,
      kind: input.kind,
      requestedCount: input.count,
      model: client.model,
      status: "pending",
    })
    .returning({ id: generationRuns.id });

  if (!run) throw new Error("could not start the generation run");

  const fail = async (message: string): Promise<never> => {
    await db
      .update(generationRuns)
      .set({ status: "failed", error: message.slice(0, 2000), completedAt: new Date() })
      .where(eq(generationRuns.id, run.id));
    throw new GenerationFailedError(message, run.id);
  };

  let response;
  try {
    response = await client.callTool({
      system: GENERATION_SYSTEM,
      prompt: buildGenerationPrompt(input),
      toolName: TOOL_NAME,
      toolDescription: TOOL_DESCRIPTION,
      inputSchema: toolSchemaFor(generationResultSchema),
    });
  } catch (error) {
    logger.error({ err: error, runId: run.id }, "generation call failed");
    return fail((error as Error).message);
  }

  // Zod is the gate. Nothing from the model reaches the database unparsed.
  const parsed = generationResultSchema.safeParse(response.data);
  if (!parsed.success) {
    logger.error({ runId: run.id, issues: parsed.error.issues }, "generation output rejected");
    return fail(
      `the model's answer did not match the schema: ${parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
        .join("; ")}`,
    );
  }

  const warnings: string[] = [];
  const result = parsed.data;
  const proposed = result.lexemes.length + result.phrases.length;

  const drafted = { count: 0 };
  const duplicates = { count: 0 };

  await insertLexemes(db, {
    runId: run.id,
    teacherId: options.requestedBy,
    proposals: result.lexemes,
    warnings,
    drafted,
    duplicates,
  });

  await insertPhrases(db, {
    runId: run.id,
    teacherId: options.requestedBy,
    proposals: result.phrases,
    warnings,
    drafted,
    duplicates,
  });

  await db
    .update(generationRuns)
    .set({
      status: "succeeded",
      modelNotes: result.notes ?? null,
      proposedCount: proposed,
      draftedCount: drafted.count,
      duplicateCount: duplicates.count,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      completedAt: new Date(),
    })
    .where(eq(generationRuns.id, run.id));

  return {
    runId: run.id,
    proposed,
    drafted: drafted.count,
    duplicates: duplicates.count,
    warnings,
    modelNotes: result.notes ?? null,
  };
}

type InsertContext = {
  runId: string;
  teacherId: string;
  warnings: string[];
  drafted: { count: number };
  duplicates: { count: number };
};

async function insertLexemes(
  db: Db,
  context: InsertContext & { proposals: ProposedLexeme[] },
): Promise<void> {
  if (!context.proposals.length) return;

  const normalized = context.proposals.map((p) => normalizeSlovene(p.slovene));
  const existing = await db
    .select({ id: lexemes.id, sloveneNormalized: lexemes.sloveneNormalized })
    .from(lexemes)
    .where(inArray(lexemes.sloveneNormalized, normalized));
  const existingByForm = new Map(existing.map((row) => [row.sloveneNormalized, row.id]));

  const seen = new Set<string>();

  for (const [index, proposal] of context.proposals.entries()) {
    const form = normalized[index] as string;

    // A batch can collide with itself as easily as with the deck.
    if (seen.has(form)) {
      context.warnings.push(`„${proposal.slovene}“ kam doppelt vor.`);
      continue;
    }
    seen.add(form);

    const collision = existingByForm.get(form);
    if (collision) {
      context.duplicates.count += 1;
      await db.insert(generationItems).values({
        runId: context.runId,
        kind: "lexeme",
        payload: proposal,
        duplicateOfLexemeId: collision,
      });
      continue;
    }

    const [created] = await db
      .insert(lexemes)
      .values({
        slovene: proposal.slovene,
        sloveneNormalized: form,
        german: proposal.german,
        partOfSpeech: proposal.partOfSpeech,
        gender: proposal.gender ?? null,
        aspect: proposal.aspect ?? null,
        register: proposal.register,
        difficulty: proposal.difficulty,
        notes: proposal.notes ?? null,
        tags: ["ai"],
        source: "ai",
        createdBy: context.teacherId,
        // Not negotiable: AI content is a draft until a person says otherwise.
        status: "draft",
      })
      .returning({ id: lexemes.id });

    if (!created) continue;
    context.drafted.count += 1;

    await db.insert(generationItems).values({
      runId: context.runId,
      kind: "lexeme",
      payload: proposal,
      lexemeId: created.id,
    });
  }
}

async function insertPhrases(
  db: Db,
  context: InsertContext & { proposals: ProposedPhrase[] },
): Promise<void> {
  if (!context.proposals.length) return;

  const normalized = context.proposals.map((p) => normalizeSlovene(p.slovene));
  const existing = await db
    .select({ id: phrases.id, sloveneNormalized: phrases.sloveneNormalized })
    .from(phrases)
    .where(inArray(phrases.sloveneNormalized, normalized));
  const existingByForm = new Map(existing.map((row) => [row.sloveneNormalized, row.id]));

  const seen = new Set<string>();

  for (const [index, proposal] of context.proposals.entries()) {
    const form = normalized[index] as string;

    if (seen.has(form)) {
      context.warnings.push(`„${proposal.slovene}“ kam doppelt vor.`);
      continue;
    }
    seen.add(form);

    const collision = existingByForm.get(form);
    if (collision) {
      context.duplicates.count += 1;
      await db.insert(generationItems).values({
        runId: context.runId,
        kind: "phrase",
        payload: proposal,
        duplicateOfPhraseId: collision,
      });
      continue;
    }

    const [created] = await db
      .insert(phrases)
      .values({
        slovene: proposal.slovene,
        sloveneNormalized: form,
        german: proposal.german,
        contextNote: proposal.contextNote ?? null,
        register: proposal.register,
        difficulty: proposal.difficulty,
        tags: ["ai"],
        source: "ai",
        createdBy: context.teacherId,
        status: "draft",
      })
      .returning({ id: phrases.id });

    if (!created) continue;
    context.drafted.count += 1;

    let clozeItemId: string | null = null;

    if (proposal.cloze) {
      const located = locateBlank(proposal.slovene, proposal.cloze.blank);
      if (!located) {
        /*
         * The blank has to be a word that is actually in the phrase. When it is
         * not, the cloze is dropped and the phrase kept — guessing which word
         * was meant is exactly the kind of quiet repair that puts a wrong
         * ending into her deck.
         */
        context.warnings.push(
          `Bei „${proposal.slovene}“ passte die Lücke („${proposal.cloze.blank}“) nicht zum Satz — Satz behalten, Lücke verworfen.`,
        );
      } else {
        const [cloze] = await db
          .insert(clozeItems)
          .values({
            phraseId: created.id,
            position: located.position,
            answer: located.answer,
            answerNormalized: normalizeSlovene(located.answer),
            focusCase: proposal.cloze.focusCase ?? null,
            focusNumber: proposal.cloze.focusNumber ?? null,
            hintDe: proposal.cloze.hintDe ?? null,
            source: "ai",
            status: "draft",
          })
          .returning({ id: clozeItems.id });
        clozeItemId = cloze?.id ?? null;
      }
    }

    await db.insert(generationItems).values({
      runId: context.runId,
      kind: "phrase",
      payload: proposal,
      phraseId: created.id,
      clozeItemId,
    });
  }
}
