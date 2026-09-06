import { and, count, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { cards, lessonProgress, lexemes, phrases, reviewLogs } from "@/db/schema";

/**
 * Progress, expressed as capability.
 *
 * There are no streaks here, no daily goals and no consecutive-day counters.
 * What she gets is a list of things she can now say — the phrasebook filling
 * up. Coming back after two weeks should feel like arriving at a longer list,
 * not like being handed a bill.
 */

/**
 * A phrase counts as "can say" once its production or speaking card is in the
 * review state with a week of stability behind it. That is roughly the point at
 * which it is likely to be there when she needs it, rather than the point at
 * which she has seen it once.
 */
const MASTERY_STABILITY_DAYS = 7;

export type Capability = {
  phraseId: string;
  slovene: string;
  german: string;
  contextNote: string | null;
  /** When she first reached the threshold, so the list reads chronologically. */
  reachedAt: Date;
  isDual: boolean;
};

export async function getCapabilities(
  db: Db,
  userId: string,
  limit = 200,
): Promise<Capability[]> {
  const rows = await db
    .selectDistinctOn([phrases.id], {
      phraseId: phrases.id,
      slovene: phrases.slovene,
      german: phrases.german,
      contextNote: phrases.contextNote,
      tags: phrases.tags,
      reachedAt: cards.lastReview,
    })
    .from(cards)
    .innerJoin(phrases, eq(phrases.id, cards.phraseId))
    .where(
      and(
        eq(cards.userId, userId),
        inArray(cards.exerciseType, ["production", "speaking"]),
        eq(cards.state, "review"),
        gte(cards.stability, MASTERY_STABILITY_DAYS),
        isNotNull(cards.lastReview),
      ),
    )
    .orderBy(phrases.id, desc(cards.stability));

  return rows
    .map((row) => ({
      phraseId: row.phraseId,
      slovene: row.slovene,
      german: row.german,
      contextNote: row.contextNote,
      reachedAt: row.reachedAt ?? new Date(0),
      isDual: (row.tags ?? []).includes("dvojina"),
    }))
    .sort((a, b) => b.reachedAt.getTime() - a.reachedAt.getTime())
    .slice(0, limit);
}

export type ProgressSummary = {
  /** Phrases she can say. The headline number, and the only one that matters. */
  canSay: number;
  /** Words she has met at all — context, not a target. */
  wordsMet: number;
  lessonsCompleted: number;
  /** Phrases using the dual that she has mastered. */
  dualMastered: number;
  /** Whether she has ever reviewed anything, for the empty state. */
  hasStarted: boolean;
};

export async function getProgressSummary(db: Db, userId: string): Promise<ProgressSummary> {
  const [canSayRow] = await db
    .select({ value: sql<number>`count(distinct ${cards.phraseId})::int` })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        inArray(cards.exerciseType, ["production", "speaking"]),
        eq(cards.state, "review"),
        gte(cards.stability, MASTERY_STABILITY_DAYS),
        isNotNull(cards.phraseId),
      ),
    );

  const [wordsRow] = await db
    .select({ value: sql<number>`count(distinct ${cards.lexemeId})::int` })
    .from(cards)
    .where(
      and(eq(cards.userId, userId), isNotNull(cards.lexemeId), isNotNull(cards.lastReview)),
    );

  const [lessonRow] = await db
    .select({ value: count() })
    .from(lessonProgress)
    .where(and(eq(lessonProgress.userId, userId), isNotNull(lessonProgress.completedAt)));

  const [dualRow] = await db
    .select({ value: sql<number>`count(distinct ${cards.phraseId})::int` })
    .from(cards)
    .innerJoin(phrases, eq(phrases.id, cards.phraseId))
    .where(
      and(
        eq(cards.userId, userId),
        inArray(cards.exerciseType, ["production", "speaking"]),
        eq(cards.state, "review"),
        gte(cards.stability, MASTERY_STABILITY_DAYS),
        sql`${phrases.tags} @> '["dvojina"]'::jsonb`,
      ),
    );

  const [reviewRow] = await db
    .select({ value: count() })
    .from(reviewLogs)
    .where(eq(reviewLogs.userId, userId));

  return {
    canSay: canSayRow?.value ?? 0,
    wordsMet: wordsRow?.value ?? 0,
    lessonsCompleted: lessonRow?.value ?? 0,
    dualMastered: dualRow?.value ?? 0,
    hasStarted: (reviewRow?.value ?? 0) > 0,
  };
}

/**
 * Words she has met, for the vocabulary side of the progress view. Kept
 * separate from capability: knowing a word is not the same as being able to
 * say something with it.
 */
export async function getWordsMet(db: Db, userId: string, limit = 100) {
  return db
    .selectDistinctOn([lexemes.id], {
      id: lexemes.id,
      slovene: lexemes.slovene,
      german: lexemes.german,
      partOfSpeech: lexemes.partOfSpeech,
      gender: lexemes.gender,
      stability: cards.stability,
    })
    .from(cards)
    .innerJoin(lexemes, eq(lexemes.id, cards.lexemeId))
    .where(and(eq(cards.userId, userId), isNotNull(cards.lastReview)))
    .orderBy(lexemes.id, desc(cards.stability))
    .limit(limit);
}
