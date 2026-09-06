"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { requireTeacher } from "@/lib/auth";
import { suggestEntry } from "@/lib/ai/assist";
import { AiUnavailableError } from "@/lib/ai/client";
import { generateDrafts, GenerationFailedError } from "@/lib/ai/generate";
import {
  approveProposal,
  decideAll,
  rejectProposal,
  type ProposalEdits,
} from "@/lib/ai/review";
import { ensureTtsAudio } from "@/lib/audio/pipeline";
import { isAiConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * The teacher's side of AI generation.
 *
 * Every action here runs on the server behind requireTeacher, which is also
 * where the API key lives. The learner's session has no route into any of it.
 */

const generateSchema = z.object({
  topic: z.string().min(3).max(400),
  instructions: z.string().max(1000).optional(),
  kind: z.enum(["mixed", "phrases", "lexemes", "cloze"]),
  count: z.coerce.number().int().min(1).max(30),
});

export type GenerateState = {
  status: "idle" | "done" | "error";
  message?: string;
  result?: {
    runId: string;
    proposed: number;
    drafted: number;
    duplicates: number;
    warnings: string[];
    modelNotes: string | null;
  };
};

export async function runGeneration(
  _prev: GenerateState,
  formData: FormData,
): Promise<GenerateState> {
  const teacher = await requireTeacher();

  if (!isAiConfigured()) return { status: "error", message: "notConfigured" };

  const parsed = generateSchema.safeParse({
    topic: String(formData.get("topic") ?? "").trim(),
    instructions: String(formData.get("instructions") ?? "").trim() || undefined,
    kind: String(formData.get("kind") ?? "mixed"),
    count: formData.get("count") ?? 8,
  });
  if (!parsed.success) return { status: "error", message: "invalidInput" };

  try {
    const summary = await generateDrafts(db, {
      requestedBy: teacher.id,
      input: parsed.data,
    });

    revalidatePath("/teacher");
    revalidatePath("/teacher/generate");
    revalidatePath("/teacher/drafts");

    return { status: "done", result: summary };
  } catch (error) {
    logger.error({ err: error }, "generation failed");
    revalidatePath("/teacher/generate");
    // The teacher sees what actually went wrong. A broken key should not look
    // like a broken app.
    return {
      status: "error",
      message:
        error instanceof GenerationFailedError || error instanceof AiUnavailableError
          ? error.message
          : "failed",
    };
  }
}

const editsSchema = z.object({
  proposalId: z.string().uuid(),
  slovene: z.string().max(300).optional(),
  german: z.string().max(500).optional(),
  contextNote: z.string().max(2000).optional(),
  register: z.enum(["standard", "colloquial", "regional", "formal"]).optional(),
});

/** Approve one proposal, with whatever the teacher corrected in the form. */
export async function approveProposalAction(formData: FormData): Promise<{ ok: true }> {
  const teacher = await requireTeacher();

  const parsed = editsSchema.parse({
    proposalId: formData.get("proposalId"),
    slovene: String(formData.get("slovene") ?? "").trim() || undefined,
    german: String(formData.get("german") ?? "").trim() || undefined,
    contextNote: String(formData.get("contextNote") ?? "").trim() || undefined,
    register: (String(formData.get("register") ?? "") || undefined) as
      | ProposalEdits["register"]
      | undefined,
  });

  const result = await approveProposal(db, {
    proposalId: parsed.proposalId,
    teacherId: teacher.id,
    edits: {
      slovene: parsed.slovene,
      german: parsed.german,
      contextNote: parsed.contextNote ?? null,
      register: parsed.register,
    },
  });

  // Approved content earns a voice; drafts never do, so no TTS is spent on
  // anything that gets thrown out.
  void ensureTtsAudio(db, {
    kind: result.kind,
    id: result.itemId,
    text: result.slovene,
  }).catch((error) => logger.warn({ err: error }, "audio generation after approval failed"));

  revalidatePath("/teacher/drafts");
  revalidatePath("/teacher/content");
  return { ok: true };
}

const proposalSchema = z.object({ proposalId: z.string().uuid() });

export async function rejectProposalAction(
  input: z.input<typeof proposalSchema>,
): Promise<{ ok: true }> {
  const teacher = await requireTeacher();
  const parsed = proposalSchema.parse(input);
  await rejectProposal(db, { proposalId: parsed.proposalId, teacherId: teacher.id });
  revalidatePath("/teacher/drafts");
  return { ok: true };
}

const batchSchema = z.object({
  runId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
});

export async function decideRunAction(
  input: z.input<typeof batchSchema>,
): Promise<{ approved: number; rejected: number }> {
  const teacher = await requireTeacher();
  const parsed = batchSchema.parse(input);

  const result = await decideAll(db, {
    runId: parsed.runId,
    teacherId: teacher.id,
    decision: parsed.decision,
  });

  revalidatePath("/teacher/drafts");
  revalidatePath("/teacher/content");
  return { approved: result.approved, rejected: result.rejected };
}

const assistSchema = z.object({
  slovene: z.string().min(1).max(300),
  hint: z.string().max(300).optional(),
});

export type AssistState =
  | { status: "ok"; suggestion: Awaited<ReturnType<typeof suggestEntry>> }
  | { status: "error"; message: string };

/**
 * Quick-capture auto-fill.
 *
 * Returns suggestions to the form and writes nothing. Whatever comes back is
 * editable and has to be saved by hand, like anything he typed himself.
 */
export async function suggestCaptureFields(
  input: z.input<typeof assistSchema>,
): Promise<AssistState> {
  await requireTeacher();

  if (!isAiConfigured()) return { status: "error", message: "notConfigured" };

  const parsed = assistSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "invalidInput" };

  try {
    const suggestion = await suggestEntry(parsed.data.slovene, { hint: parsed.data.hint });
    return { status: "ok", suggestion };
  } catch (error) {
    logger.warn({ err: error }, "capture assist failed");
    return { status: "error", message: "failed" };
  }
}
