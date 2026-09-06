"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { requireTeacher } from "@/lib/auth";
import { ensureTtsAudio } from "@/lib/audio/pipeline";
import { logger } from "@/lib/logger";
import { captureItem } from "@/lib/teacher/capture";
import { setArchived, updateContentItem } from "@/lib/teacher/content";
import {
  addHumanRecording,
  promoteRecording,
  removeRecording,
} from "@/lib/teacher/recordings";

const registerSchema = z.enum(["standard", "colloquial", "regional", "formal"]);
const kindSchema = z.enum(["phrase", "lexeme"]);

const captureSchema = z.object({
  slovene: z.string().min(1).max(300),
  german: z.string().max(300).optional(),
  contextNote: z.string().max(1000).optional(),
  tags: z.string().max(300).optional(),
  register: registerSchema.optional(),
  regionLabel: z.string().max(120).optional(),
});

export type CaptureState = {
  status: "idle" | "saved" | "error";
  message?: string;
  /** Set on success so a recording can be attached straight away. */
  saved?: { id: string; kind: "phrase" | "lexeme"; slovene: string; duplicate: boolean };
};

/**
 * Quick capture. Only the Slovene is required — the rest can wait until the
 * moment at the table has passed.
 */
export async function quickCapture(
  _prev: CaptureState,
  formData: FormData,
): Promise<CaptureState> {
  const teacher = await requireTeacher();

  const parsed = captureSchema.safeParse({
    slovene: String(formData.get("slovene") ?? "").trim(),
    german: String(formData.get("german") ?? "").trim() || undefined,
    contextNote: String(formData.get("contextNote") ?? "").trim() || undefined,
    tags: String(formData.get("tags") ?? "").trim() || undefined,
    register: (String(formData.get("register") ?? "") || undefined) as
      | z.infer<typeof registerSchema>
      | undefined,
    regionLabel: String(formData.get("regionLabel") ?? "").trim() || undefined,
  });

  if (!parsed.success) return { status: "error", message: "missingSlovene" };

  try {
    const result = await captureItem(db, teacher.id, {
      slovene: parsed.data.slovene,
      german: parsed.data.german,
      contextNote: parsed.data.contextNote,
      register: parsed.data.register,
      regionLabel: parsed.data.regionLabel,
      tags: parsed.data.tags
        ? parsed.data.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
        : [],
    });

    // Generated audio is a bonus here, never a blocker: the capture is saved
    // whether or not Piper is up.
    void ensureTtsAudio(db, {
      kind: result.kind,
      id: result.id,
      text: parsed.data.slovene,
    }).catch((error) => logger.warn({ err: error }, "capture audio generation failed"));

    revalidatePath("/teacher");
    revalidatePath("/teacher/content");

    return {
      status: "saved",
      saved: {
        id: result.id,
        kind: result.kind,
        slovene: parsed.data.slovene,
        duplicate: result.duplicate,
      },
    };
  } catch (error) {
    logger.error({ err: error }, "quick capture failed");
    return { status: "error", message: "saveFailed" };
  }
}

const editSchema = z.object({
  kind: kindSchema,
  id: z.string().uuid(),
  slovene: z.string().min(1).max(300),
  german: z.string().max(500),
  contextNote: z.string().max(2000).optional(),
  register: registerSchema,
  regionLabel: z.string().max(120).optional(),
  tags: z.string().max(300).optional(),
  status: z.enum(["draft", "active", "archived"]),
});

export async function saveContentItem(formData: FormData): Promise<{ ok: true }> {
  await requireTeacher();

  const parsed = editSchema.parse({
    kind: formData.get("kind"),
    id: formData.get("id"),
    slovene: String(formData.get("slovene") ?? "").trim(),
    german: String(formData.get("german") ?? "").trim(),
    contextNote: String(formData.get("contextNote") ?? "").trim() || undefined,
    register: String(formData.get("register") ?? "standard"),
    regionLabel: String(formData.get("regionLabel") ?? "").trim() || undefined,
    tags: String(formData.get("tags") ?? "").trim() || undefined,
    status: String(formData.get("status") ?? "active"),
  });

  const { textChanged } = await updateContentItem(db, parsed.kind, parsed.id, {
    slovene: parsed.slovene,
    german: parsed.german,
    contextNote: parsed.contextNote ?? null,
    register: parsed.register,
    regionLabel: parsed.regionLabel ?? null,
    tags: parsed.tags
      ? parsed.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      : undefined,
    status: parsed.status,
  });

  // The audio store is keyed by a hash of the text, so edited text needs new
  // audio. Regenerating here keeps the card and its sound in step.
  if (textChanged) {
    void ensureTtsAudio(db, {
      kind: parsed.kind,
      id: parsed.id,
      text: parsed.slovene,
    }).catch((error) => logger.warn({ err: error }, "audio regeneration failed"));
  }

  revalidatePath("/teacher/content");
  revalidatePath(`/teacher/items/${parsed.kind}/${parsed.id}`);
  return { ok: true };
}

const archiveSchema = z.object({
  kind: kindSchema,
  id: z.string().uuid(),
  archived: z.boolean(),
});

export async function archiveContentItem(
  input: z.input<typeof archiveSchema>,
): Promise<{ ok: true }> {
  await requireTeacher();
  const parsed = archiveSchema.parse(input);
  await setArchived(db, parsed.kind, parsed.id, parsed.archived);

  revalidatePath("/teacher/content");
  revalidatePath(`/teacher/items/${parsed.kind}/${parsed.id}`);
  return { ok: true };
}

const ALLOWED_AUDIO = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"];

/** Attaches a recorded or uploaded voice to an item. */
export async function uploadRecording(formData: FormData): Promise<{ ok: true }> {
  const teacher = await requireTeacher();

  const kind = kindSchema.parse(formData.get("kind"));
  const itemId = z.string().uuid().parse(formData.get("itemId"));
  const speakerLabel = z.string().min(1).max(60).parse(formData.get("speakerLabel"));

  const file = formData.get("audio");
  if (!(file instanceof File)) throw new Error("no audio was uploaded");

  const mimeType = (file.type || "audio/webm").split(";")[0]?.trim() ?? "audio/webm";
  if (!ALLOWED_AUDIO.includes(mimeType)) throw new Error(`unsupported audio type ${mimeType}`);

  await addHumanRecording(db, {
    kind,
    itemId,
    audio: Buffer.from(await file.arrayBuffer()),
    mimeType,
    speakerLabel,
    durationMs: Number(formData.get("durationMs")) || undefined,
    createdBy: teacher.id,
  });

  revalidatePath(`/teacher/items/${kind}/${itemId}`);
  return { ok: true };
}

const assetSchema = z.object({ assetId: z.string().uuid() });

export async function deleteRecording(
  input: z.input<typeof assetSchema>,
): Promise<{ ok: true }> {
  await requireTeacher();
  await removeRecording(db, assetSchema.parse(input).assetId);
  revalidatePath("/teacher");
  return { ok: true };
}

export async function makePrimaryRecording(
  input: z.input<typeof assetSchema>,
): Promise<{ ok: true }> {
  await requireTeacher();
  await promoteRecording(db, assetSchema.parse(input).assetId);
  revalidatePath("/teacher");
  return { ok: true };
}

const answerSchema = z.object({
  questionId: z.string().uuid(),
  text: z.string().max(4000).optional(),
});

/**
 * Answers one question with text, a voice note, or both. The answer attaches to
 * the item permanently and shows on that card from then on.
 */
export async function answerInboxQuestion(formData: FormData): Promise<{ ok: true }> {
  const teacher = await requireTeacher();

  const parsed = answerSchema.parse({
    questionId: formData.get("questionId"),
    text: String(formData.get("text") ?? "").trim() || undefined,
  });

  const file = formData.get("audio");
  const hasAudio = file instanceof File && file.size > 0;

  if (hasAudio) {
    const mimeType = (file.type || "audio/webm").split(";")[0]?.trim() ?? "audio/webm";
    if (!ALLOWED_AUDIO.includes(mimeType)) throw new Error(`unsupported audio type ${mimeType}`);
  }

  const { answerQuestion } = await import("@/lib/questions/service");

  await answerQuestion(db, {
    questionId: parsed.questionId,
    answeredBy: teacher.id,
    text: parsed.text,
    ...(hasAudio
      ? {
          audio: {
            data: Buffer.from(await (file as File).arrayBuffer()),
            mimeType: ((file as File).type || "audio/webm").split(";")[0] as string,
            durationMs: Number(formData.get("durationMs")) || undefined,
          },
        }
      : {}),
  });

  revalidatePath("/teacher");
  revalidatePath("/teacher/inbox");
  revalidatePath("/review");
  return { ok: true };
}
