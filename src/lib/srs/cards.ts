import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { cards, clozeItems, lessonItems, lexemes, phrases } from "@/db/schema";
import { isAsrConfigured, isTtsConfigured } from "@/lib/env";
import { newCardState } from "./scheduler";

export type ExerciseType =
  | "recognition"
  | "production"
  | "listening"
  | "speaking"
  | "cloze"
  | "dictation";

/**
 * Which exercises an item produces. A phrase earns the full set because a
 * phrase is something she can actually say to a person; a single word gets the
 * reading and typing exercises plus listening.
 */
export const PHRASE_EXERCISES: ExerciseType[] = [
  "recognition",
  "production",
  "listening",
  "speaking",
];

export const LEXEME_EXERCISES: ExerciseType[] = ["recognition", "production", "listening"];

export const CLOZE_EXERCISES: ExerciseType[] = ["cloze"];

/**
 * Dictation is a late-stage exercise: typing a whole unfamiliar utterance from
 * audio is discouraging early on. It unlocks once the listening card for the
 * same item is genuinely stable.
 */
export const DICTATION_UNLOCK_STABILITY = 21;

/**
 * Exercises the app can actually run right now. Whisper and Piper are optional
 * at runtime, so their exercises disappear rather than failing mid-session.
 */
export function availableExerciseTypes(): ExerciseType[] {
  const available: ExerciseType[] = ["recognition", "production", "cloze"];
  if (isTtsConfigured()) available.push("listening", "dictation");
  if (isAsrConfigured()) available.push("speaking");
  return available;
}

type CardSeed = {
  userId: string;
  exerciseType: ExerciseType;
  lexemeId?: string;
  phraseId?: string;
  clozeItemId?: string;
  introducedByLessonId?: string | null;
};

function seedRow(seed: CardSeed): typeof cards.$inferInsert {
  const state = newCardState();
  return {
    userId: seed.userId,
    exerciseType: seed.exerciseType,
    lexemeId: seed.lexemeId ?? null,
    phraseId: seed.phraseId ?? null,
    clozeItemId: seed.clozeItemId ?? null,
    introducedByLessonId: seed.introducedByLessonId ?? null,
    due: state.due,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsedDays: state.elapsedDays,
    scheduledDays: state.scheduledDays,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    lastReview: state.lastReview,
    learningSteps: state.learningSteps,
  };
}

export type CardGenerationResult = { created: number; skipped: number };

/**
 * Creates the missing cards for a set of items. Safe to call repeatedly: the
 * unique indexes on (user, item, exercise type) make re-runs a no-op, so a
 * lesson replayed twice never doubles her workload.
 */
export async function createCardsForItems(
  db: Db,
  userId: string,
  items: {
    lexemeIds?: string[];
    phraseIds?: string[];
    clozeItemIds?: string[];
    lessonId?: string | null;
  },
  exerciseTypes: ExerciseType[] = availableExerciseTypes(),
): Promise<CardGenerationResult> {
  const seeds: CardSeed[] = [];
  const allowed = new Set(exerciseTypes);

  for (const lexemeId of items.lexemeIds ?? []) {
    for (const exerciseType of LEXEME_EXERCISES) {
      if (!allowed.has(exerciseType)) continue;
      seeds.push({ userId, exerciseType, lexemeId, introducedByLessonId: items.lessonId ?? null });
    }
  }

  for (const phraseId of items.phraseIds ?? []) {
    for (const exerciseType of PHRASE_EXERCISES) {
      if (!allowed.has(exerciseType)) continue;
      seeds.push({ userId, exerciseType, phraseId, introducedByLessonId: items.lessonId ?? null });
    }
  }

  for (const clozeItemId of items.clozeItemIds ?? []) {
    for (const exerciseType of CLOZE_EXERCISES) {
      if (!allowed.has(exerciseType)) continue;
      seeds.push({
        userId,
        exerciseType,
        clozeItemId,
        introducedByLessonId: items.lessonId ?? null,
      });
    }
  }

  if (!seeds.length) return { created: 0, skipped: 0 };

  let created = 0;
  for (let i = 0; i < seeds.length; i += 500) {
    const batch = seeds.slice(i, i + 500).map(seedRow);
    const inserted = await db
      .insert(cards)
      .values(batch)
      .onConflictDoNothing()
      .returning({ id: cards.id });
    created += inserted.length;
  }

  return { created, skipped: seeds.length - created };
}

/** Every item a lesson introduces, ready to be handed to FSRS. */
export async function createCardsForLesson(
  db: Db,
  userId: string,
  lessonId: string,
): Promise<CardGenerationResult> {
  const items = await db
    .select({ lexemeId: lessonItems.lexemeId, phraseId: lessonItems.phraseId })
    .from(lessonItems)
    .where(eq(lessonItems.lessonId, lessonId));

  const phraseIds = items.map((i) => i.phraseId).filter((v): v is string => Boolean(v));

  // Cloze exercises belong to the phrases the lesson introduces.
  const clozeIds = phraseIds.length
    ? (
        await db
          .select({ id: clozeItems.id })
          .from(clozeItems)
          .where(and(inArray(clozeItems.phraseId, phraseIds), eq(clozeItems.status, "active")))
      ).map((row) => row.id)
    : [];

  return createCardsForItems(db, userId, {
    lexemeIds: items.map((i) => i.lexemeId).filter((v): v is string => Boolean(v)),
    phraseIds,
    clozeItemIds: clozeIds,
    lessonId,
  });
}

/**
 * Creates cards for all active content that has none yet.
 *
 * Lessons are the normal way material enters her deck, but the teacher's
 * quick-capture additions and approved AI drafts need a path in too — this is
 * that path.
 */
export async function createCardsForActiveContent(
  db: Db,
  userId: string,
  limit = 200,
): Promise<CardGenerationResult> {
  const existing = await db
    .select({
      lexemeId: cards.lexemeId,
      phraseId: cards.phraseId,
      clozeItemId: cards.clozeItemId,
    })
    .from(cards)
    .where(eq(cards.userId, userId));

  const haveLexeme = new Set(existing.map((c) => c.lexemeId).filter(Boolean));
  const havePhrase = new Set(existing.map((c) => c.phraseId).filter(Boolean));
  const haveCloze = new Set(existing.map((c) => c.clozeItemId).filter(Boolean));

  const activePhrases = (
    await db.select({ id: phrases.id }).from(phrases).where(eq(phrases.status, "active"))
  )
    .map((row) => row.id)
    .filter((id) => !havePhrase.has(id))
    .slice(0, limit);

  const activeCloze = (
    await db.select({ id: clozeItems.id }).from(clozeItems).where(eq(clozeItems.status, "active"))
  )
    .map((row) => row.id)
    .filter((id) => !haveCloze.has(id))
    .slice(0, limit);

  // A word earns cards only once it has a German gloss — an unglossed lexeme
  // would produce a card with nothing on the back of it.
  const activeLexemes = (
    await db
      .select({ id: lexemes.id })
      .from(lexemes)
      .where(and(eq(lexemes.status, "active"), sql`jsonb_array_length(${lexemes.german}) > 0`))
  )
    .map((row) => row.id)
    .filter((id) => !haveLexeme.has(id))
    .slice(0, limit);

  return createCardsForItems(db, userId, {
    lexemeIds: activeLexemes,
    phraseIds: activePhrases,
    clozeItemIds: activeCloze,
  });
}
