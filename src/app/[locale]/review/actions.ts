"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { compareAnswer, type AnswerComparison } from "@/lib/answers/compare";
import { logger } from "@/lib/logger";
import { getCardPrompt, submitReview } from "@/lib/session/service";
import type { CardRating } from "@/lib/srs/scheduler";

const ratingSchema = z.enum(["again", "hard", "good", "easy"]);

const submitSchema = z.object({
  sessionId: z.string().uuid(),
  cardId: z.string().uuid(),
  rating: ratingSchema,
  durationMs: z.number().int().nonnegative().max(1000 * 60 * 60).optional(),
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

  const comparison = compareAnswer(parsed.answer, prompt.answer);
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
