"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { compareAgainstAny, type AnswerComparison } from "@/lib/answers/compare";
import { logger } from "@/lib/logger";
import { getCardPrompt, submitReview } from "@/lib/session/service";
import type { CardRating } from "@/lib/srs/scheduler";

const ratingSchema = z.enum(["again", "hard", "good", "easy"]);

const submitSchema = z.object({
  sessionId: z.string().uuid(),
  cardId: z.string().uuid(),
  rating: ratingSchema,
  durationMs: z.number().int().nonnegative().max(1000 * 60 * 60).optional(),
  /**
   * Whether this rating agreed with what speech scoring suggested. She always
   * taps the rating herself; this only records how often the recogniser and she
   * disagree, which is worth knowing before trusting it further.
   */
  ratingSource: z.enum(["manual", "auto_speech", "overridden"]).optional(),
});

export type SubmitAnswerInput = z.input<typeof submitSchema>;

export async function submitAnswer(input: SubmitAnswerInput): Promise<{ finished: boolean }> {
  const user = await requireUser();
  const parsed = submitSchema.parse(input);

  const result = await submitReview(db, {
    userId: user.id,
    sessionId: parsed.sessionId,
    cardId: parsed.cardId,
    rating: parsed.rating as CardRating,
    durationMs: parsed.durationMs,
    ratingSource: parsed.ratingSource ?? "manual",
  });

  logger.debug({ cardId: parsed.cardId, rating: parsed.rating }, "review recorded");
  revalidatePath("/review");
  revalidatePath("/");
  return { finished: result.finished };
}

const checkSchema = z.object({
  cardId: z.string().uuid(),
  answer: z.string().max(500),
});

export type CheckAnswerResult = AnswerComparison & { suggestedRating: CardRating };

/**
 * Grades a typed answer server-side. The expected answer never travels to the
 * browser before she has answered, so the card cannot be read out of the DOM.
 */
export async function checkAnswer(input: z.input<typeof checkSchema>): Promise<CheckAnswerResult> {
  await requireUser();
  const parsed = checkSchema.parse(input);

  const prompt = await getCardPrompt(db, parsed.cardId);
  if (!prompt) throw new Error("card not found");

  const comparison = compareAgainstAny(parsed.answer, prompt.acceptableAnswers);
  const suggestedRating: CardRating =
    comparison.verdict === "correct" ? "good" : comparison.verdict === "almost" ? "hard" : "again";

  return { ...comparison, suggestedRating };
}

const nextCardSchema = z.object({ sessionId: z.string().uuid() });

/**
 * The card at the session's current cursor. Fetched one at a time so the
 * answers to upcoming cards are never sitting in the browser.
 */
export async function getNextCard(input: z.input<typeof nextCardSchema>) {
  const user = await requireUser();
  const { sessionId } = nextCardSchema.parse(input);

  const { and, eq } = await import("drizzle-orm");
  const { studySessions } = await import("@/db/schema");

  const [session] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, user.id)))
    .limit(1);

  if (!session) throw new Error("session not found");

  const cardId = session.queue[session.cursor];
  if (!cardId) return { card: null, cursor: session.cursor, total: session.queue.length };

  return {
    card: await getCardPrompt(db, cardId),
    cursor: session.cursor,
    total: session.queue.length,
  };
}

const speechSchema = z.object({
  cardId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
});

export type SpeechAttemptResponse = {
  status: "scored" | "pending" | "failed";
  transcript: string | null;
  band: "good" | "close" | "off" | null;
  suggestedRating: CardRating | null;
  charSimilarity: number | null;
  diff: { kind: "same" | "missing" | "extra"; text: string }[];
  /** Present when there is no score; the UI then offers self-assessment. */
  reason?: string;
};

/** Browsers record webm/ogg (Chromium, Firefox) or mp4/m4a (Safari). */
const ALLOWED_AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"];
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * Takes one recording, stores it, and scores it if the recogniser is up.
 *
 * The audio is kept either way: if Whisper is unavailable the attempt stays
 * pending and is scored on the next sync, and the card falls back to
 * self-assessment rather than failing.
 */
export async function submitSpeechAttempt(formData: FormData): Promise<SpeechAttemptResponse> {
  const user = await requireUser();

  const parsed = speechSchema.parse({
    cardId: formData.get("cardId"),
    sessionId: formData.get("sessionId") ?? undefined,
  });

  const file = formData.get("audio");
  if (!(file instanceof File)) throw new Error("no audio was uploaded");
  if (file.size === 0) throw new Error("the recording was empty");
  if (file.size > MAX_AUDIO_BYTES) throw new Error("the recording is too large");

  const mimeType = (file.type || "audio/webm").split(";")[0]?.trim() ?? "audio/webm";
  if (!ALLOWED_AUDIO_TYPES.includes(mimeType)) {
    throw new Error(`unsupported audio type ${mimeType}`);
  }

  const prompt = await getCardPrompt(db, parsed.cardId);
  if (!prompt) throw new Error("card not found");

  const { recordSpeechAttempt } = await import("@/lib/speech/attempts");

  const result = await recordSpeechAttempt(db, {
    userId: user.id,
    cardId: parsed.cardId,
    studySessionId: parsed.sessionId ?? null,
    // Speaking cards ask her to produce the Slovene, whatever side is shown.
    targetText: prompt.slovene,
    audio: Buffer.from(await file.arrayBuffer()),
    mimeType,
    durationMs: Number(formData.get("durationMs")) || undefined,
  });

  return {
    status: result.status,
    transcript: result.transcript,
    band: result.score?.band ?? null,
    suggestedRating: result.score?.suggestedRating ?? null,
    charSimilarity: result.score?.charSimilarity ?? null,
    diff: result.diff,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

const askSchema = z.object({
  cardId: z.string().uuid(),
  body: z.string().max(2000).optional(),
});

/**
 * "Verstehe ich nicht".
 *
 * Files the question and returns immediately — the session must not pause for
 * it. Failure is swallowed on purpose: losing a question is bad, but stopping
 * her session over one is worse.
 */
export async function askAboutCard(
  input: z.input<typeof askSchema>,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const parsed = askSchema.parse(input);

  try {
    const { askQuestion } = await import("@/lib/questions/service");
    await askQuestion(db, {
      askedBy: user.id,
      cardId: parsed.cardId,
      body: parsed.body,
    });
    return { ok: true };
  } catch (error) {
    logger.error({ err: error, cardId: parsed.cardId }, "could not file question");
    return { ok: false };
  }
}
