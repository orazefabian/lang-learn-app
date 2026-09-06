import { and, count, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  cards,
  clozeItems,
  lexemes,
  phrases,
  reviewLogs,
  studySessions,
  userSettings,
} from "@/db/schema";
import { getAudioForItem, type PlayableAudio } from "@/lib/audio/resolve";
import { getAnswersForItem, type ItemAnswer } from "@/lib/questions/service";
import { availableExerciseTypes, type ExerciseType } from "@/lib/srs/cards";
import {
  buildSessionQueue,
  displayDueCount,
  type QueueCandidate,
  type QueueSettings,
} from "@/lib/srs/queue";
import { gradeCard, type CardRating, type SchedulerState } from "@/lib/srs/scheduler";
import { tokenizePhrase } from "@/lib/seed/schemas";

export type SessionSettings = QueueSettings & {
  exerciseMix: Record<string, number>;
  autoplayAudio: boolean;
};

const DEFAULT_SETTINGS: SessionSettings = {
  reviewCap: 20,
  dailyNewLimit: 8,
  newMaterialBacklogThreshold: 60,
  exerciseMix: {
    speaking: 3,
    listening: 3,
    recognition: 2,
    production: 2,
    cloze: 1,
    dictation: 1,
  },
  autoplayAudio: true,
};

export async function getSettings(db: Db, userId: string): Promise<SessionSettings> {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  if (!row) return DEFAULT_SETTINGS;
  return {
    reviewCap: row.reviewCap,
    dailyNewLimit: row.dailyNewLimit,
    newMaterialBacklogThreshold: row.newMaterialBacklogThreshold,
    exerciseMix: row.exerciseMix,
    autoplayAudio: row.autoplayAudio,
  };
}

/** New items already introduced today, so the daily limit survives app restarts. */
export async function countNewIntroducedToday(db: Db, userId: string, now = new Date()) {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const [row] = await db
    .select({ value: count() })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        gte(cards.introducedAt, startOfDay),
        lte(cards.introducedAt, now),
      ),
    );
  return row?.value ?? 0;
}

/**
 * Weighted interleave, so a session is not four listening cards in a row.
 * The mix is a preference, not a quota: whatever is due still gets shown.
 */
export function interleaveByMix<T extends { exerciseType: ExerciseType }>(
  items: T[],
  mix: Record<string, number>,
): T[] {
  const buckets = new Map<ExerciseType, T[]>();
  for (const item of items) {
    const bucket = buckets.get(item.exerciseType);
    if (bucket) bucket.push(item);
    else buckets.set(item.exerciseType, [item]);
  }

  const ordered: T[] = [];
  // Draw from the bucket that is furthest behind its share of the session.
  const drawn = new Map<ExerciseType, number>();
  while (ordered.length < items.length) {
    let best: ExerciseType | null = null;
    let bestDeficit = -Infinity;

    for (const [type, bucket] of buckets) {
      if (!bucket.length) continue;
      const weight = mix[type] ?? 1;
      const deficit = weight / ((drawn.get(type) ?? 0) + 1);
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = type;
      }
    }

    if (!best) break;
    const bucket = buckets.get(best) as T[];
    ordered.push(bucket.shift() as T);
    drawn.set(best, (drawn.get(best) ?? 0) + 1);
  }

  return ordered;
}

export type SessionOverview = {
  displayedDue: number;
  hasMoreThanShown: boolean;
  newAvailable: number;
};

/** What the home screen needs. Never exposes the raw backlog size. */
export async function getSessionOverview(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<SessionOverview> {
  const settings = await getSettings(db, userId);
  const types = availableExerciseTypes();

  // New cards are not "due": they are material she has not met yet, and the
  // daily limit governs them. Counting them here would make the home screen
  // promise a session the queue builder will not produce.
  const due = await db
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.suspended, false),
        ne(cards.state, "new"),
        lte(cards.due, now),
        inArray(cards.exerciseType, types),
      ),
    );

  const [newRow] = await db
    .select({ value: count() })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.suspended, false),
        eq(cards.state, "new"),
        inArray(cards.exerciseType, types),
      ),
    );

  return {
    displayedDue: displayDueCount(due.length, settings.reviewCap),
    hasMoreThanShown: due.length > settings.reviewCap,
    newAvailable: newRow?.value ?? 0,
  };
}

export type StartSessionResult = {
  sessionId: string;
  queue: string[];
  cursor: number;
  resumed: boolean;
};

/**
 * Resumes the active session if there is one, otherwise builds a new queue.
 * Closing the app mid-session loses nothing because the queue and the cursor
 * live here, not in the browser.
 */
export async function startOrResumeSession(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<StartSessionResult> {
  const [active] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.userId, userId), eq(studySessions.status, "active")))
    .orderBy(desc(studySessions.startedAt))
    .limit(1);

  if (active && active.cursor < active.queue.length) {
    return {
      sessionId: active.id,
      queue: active.queue,
      cursor: active.cursor,
      resumed: true,
    };
  }

  if (active) {
    await db
      .update(studySessions)
      .set({ status: "completed", endedAt: now })
      .where(eq(studySessions.id, active.id));
  }

  const settings = await getSettings(db, userId);
  const types = availableExerciseTypes();

  const dueRows = await db
    .select({
      id: cards.id,
      due: cards.due,
      scheduledDays: cards.scheduledDays,
      stability: cards.stability,
      state: cards.state,
      exerciseType: cards.exerciseType,
    })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.suspended, false),
        lte(cards.due, now),
        inArray(cards.exerciseType, types),
      ),
    );

  const newRows = await db
    .select({
      id: cards.id,
      due: cards.due,
      scheduledDays: cards.scheduledDays,
      stability: cards.stability,
      state: cards.state,
      exerciseType: cards.exerciseType,
    })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.suspended, false),
        eq(cards.state, "new"),
        inArray(cards.exerciseType, types),
      ),
    )
    .limit(200);

  const dueCandidates: QueueCandidate[] = dueRows
    .filter((row) => row.state !== "new")
    .map((row) => ({
      id: row.id,
      due: row.due,
      scheduledDays: row.scheduledDays,
      stability: row.stability,
      state: row.state,
    }));

  const result = buildSessionQueue({
    due: dueCandidates,
    newCards: newRows.map((row) => ({
      id: row.id,
      due: row.due,
      scheduledDays: row.scheduledDays,
      stability: row.stability,
      state: row.state,
    })),
    settings,
    newIntroducedToday: await countNewIntroducedToday(db, userId, now),
    now,
  });

  const byId = new Map([...dueRows, ...newRows].map((row) => [row.id, row]));
  const ordered = interleaveByMix(
    result.queue
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map((row) => ({ id: row.id, exerciseType: row.exerciseType as ExerciseType })),
    settings.exerciseMix,
  ).map((row) => row.id);

  const [created] = await db
    .insert(studySessions)
    .values({
      userId,
      kind: "review",
      status: "active",
      queue: ordered,
      cursor: 0,
      config: {
        reviewCap: settings.reviewCap,
        dailyNewLimit: settings.dailyNewLimit,
        newMaterialWithheld: result.newMaterialWithheld,
        totalDue: result.totalDueCount,
      },
      startedAt: now,
      lastActiveAt: now,
    })
    .returning({ id: studySessions.id });

  if (!created) throw new Error("could not start a study session");

  // New cards count against the daily limit from the moment they are queued.
  if (result.newIds.length) {
    await db
      .update(cards)
      .set({ introducedAt: now })
      .where(inArray(cards.id, result.newIds));
  }

  return { sessionId: created.id, queue: ordered, cursor: 0, resumed: false };
}

export type CardPrompt = {
  cardId: string;
  exerciseType: ExerciseType;
  /** What she is asked. Empty for listening cards: the audio is the prompt. */
  prompt: string;
  /** What counts as right. */
  answer: string;
  /**
   * Every answer that counts. A word often has more than one honest German
   * gloss, and being marked wrong for picking the other one teaches nothing.
   */
  acceptableAnswers: string[];
  /** Human recordings first, generated speech last. */
  audio: PlayableAudio[];
  /**
   * Answers the teacher has given about this item. They stay on the card from
   * then on, not just the once — that is the whole point of asking.
   */
  answers: ItemAnswer[];
  /** Shown after answering. */
  slovene: string;
  german: string;
  contextNote: string | null;
  hintDe: string | null;
  register: string;
  regionLabel: string | null;
  /** For cloze: the sentence with the blank marked as ___. */
  clozeSentence: string | null;
  isNew: boolean;
};

/** Everything the UI needs to render one card. */
export async function getCardPrompt(db: Db, cardId: string): Promise<CardPrompt | null> {
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) return null;

  const exerciseType = card.exerciseType as ExerciseType;
  const isNew = card.state === "new";
  const audio = await getAudioForItem(db, {
    phraseId: card.phraseId,
    lexemeId: card.lexemeId,
  });
  const answers = await getAnswersForItem(db, {
    phraseId: card.phraseId,
    lexemeId: card.lexemeId,
  });

  if (card.phraseId) {
    const [phrase] = await db.select().from(phrases).where(eq(phrases.id, card.phraseId)).limit(1);
    if (!phrase) return null;
    // Listening cards show nothing at first: the audio is the whole prompt.
    const prompt =
      exerciseType === "listening" || exerciseType === "dictation"
        ? ""
        : exerciseType === "production"
          ? phrase.german
          : phrase.slovene;
    const answer =
      exerciseType === "production" || exerciseType === "dictation"
        ? phrase.slovene
        : phrase.german;

    return {
      cardId,
      exerciseType,
      prompt,
      answer,
      acceptableAnswers: [answer],
      audio,
      answers,
      slovene: phrase.slovene,
      german: phrase.german,
      contextNote: phrase.contextNote,
      hintDe: null,
      register: phrase.register,
      regionLabel: phrase.regionLabel,
      clozeSentence: null,
      isNew,
    };
  }

  if (card.lexemeId) {
    const [lexeme] = await db.select().from(lexemes).where(eq(lexemes.id, card.lexemeId)).limit(1);
    if (!lexeme) return null;
    const german = lexeme.german.join(", ");
    const prompt =
      exerciseType === "listening" || exerciseType === "dictation"
        ? ""
        : exerciseType === "production"
          ? german
          : lexeme.slovene;
    const answer =
      exerciseType === "production" || exerciseType === "dictation"
        ? lexeme.slovene
        : german;

    return {
      cardId,
      exerciseType,
      prompt,
      answer,
      // Any of the glosses counts, not just the joined string.
      acceptableAnswers:
        exerciseType === "production" || exerciseType === "dictation"
          ? [lexeme.slovene]
          : [german, ...lexeme.german],
      audio,
      answers,
      slovene: lexeme.slovene,
      german,
      contextNote: lexeme.notes,
      hintDe: null,
      register: lexeme.register,
      regionLabel: lexeme.regionLabel,
      clozeSentence: null,
      isNew,
    };
  }

  if (card.clozeItemId) {
    const [cloze] = await db
      .select()
      .from(clozeItems)
      .where(eq(clozeItems.id, card.clozeItemId))
      .limit(1);
    if (!cloze) return null;
    const [phrase] = await db.select().from(phrases).where(eq(phrases.id, cloze.phraseId)).limit(1);
    if (!phrase) return null;

    const tokens = tokenizePhrase(phrase.slovene);
    const blanked = tokens
      .map((token, index) => (index === cloze.position ? "___" : token))
      .join(" ");

    return {
      cardId,
      exerciseType,
      prompt: blanked,
      answer: cloze.answer,
      acceptableAnswers: [cloze.answer],
      audio,
      answers,
      slovene: phrase.slovene,
      german: phrase.german,
      contextNote: phrase.contextNote,
      hintDe: cloze.hintDe,
      register: phrase.register,
      regionLabel: phrase.regionLabel,
      clozeSentence: blanked,
      isNew,
    };
  }

  return null;
}

export type SubmitResult = {
  nextCursor: number;
  finished: boolean;
  nextDue: Date;
};

/**
 * Records one answer: grades the card, appends the review log, advances the
 * session cursor. Written as one transaction so an interrupted request cannot
 * leave a graded card with no log, or a log with no schedule change.
 */
export async function submitReview(
  db: Db,
  params: {
    userId: string;
    sessionId: string;
    cardId: string;
    rating: CardRating;
    ratingSource?: "manual" | "auto_speech" | "overridden";
    durationMs?: number;
    now?: Date;
    /** Set for answers replayed from an offline queue; unique, so a retried
     * sync collides here instead of grading the card a second time. */
    clientEventId?: string;
    syncedAt?: Date;
  },
): Promise<SubmitResult> {
  const now = params.now ?? new Date();

  return db.transaction(async (tx) => {
    const [card] = await tx.select().from(cards).where(eq(cards.id, params.cardId)).limit(1);
    if (!card) throw new Error(`card ${params.cardId} not found`);
    if (card.userId !== params.userId) throw new Error("card belongs to another user");

    const state: SchedulerState = {
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: card.elapsedDays,
      scheduledDays: card.scheduledDays,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      lastReview: card.lastReview,
      learningSteps: card.learningSteps,
    };

    const { next, log } = gradeCard(state, params.rating, now);

    await tx
      .update(cards)
      .set({
        due: next.due,
        stability: next.stability,
        difficulty: next.difficulty,
        elapsedDays: next.elapsedDays,
        scheduledDays: next.scheduledDays,
        reps: next.reps,
        lapses: next.lapses,
        state: next.state,
        lastReview: next.lastReview,
        learningSteps: next.learningSteps,
        introducedAt: card.introducedAt ?? now,
        updatedAt: now,
      })
      .where(eq(cards.id, card.id));

    await tx.insert(reviewLogs).values({
      cardId: card.id,
      userId: params.userId,
      studySessionId: params.sessionId,
      rating: log.rating,
      ratingSource: params.ratingSource ?? "manual",
      state: log.state,
      due: log.due,
      stability: log.stability,
      difficulty: log.difficulty,
      elapsedDays: log.elapsedDays,
      lastElapsedDays: log.lastElapsedDays,
      scheduledDays: log.scheduledDays,
      learningSteps: log.learningSteps,
      reviewedAt: log.reviewedAt,
      stateAfter: {
        due: next.due.toISOString(),
        stability: next.stability,
        difficulty: next.difficulty,
        state: next.state,
      },
      durationMs: params.durationMs ?? null,
      clientEventId: params.clientEventId ?? null,
      syncedAt: params.syncedAt ?? null,
    });

    const [session] = await tx
      .select()
      .from(studySessions)
      .where(eq(studySessions.id, params.sessionId))
      .limit(1);
    if (!session) throw new Error("session not found");

    const nextCursor = session.cursor + 1;
    const finished = nextCursor >= session.queue.length;

    await tx
      .update(studySessions)
      .set({
        cursor: nextCursor,
        answeredCount: session.answeredCount + 1,
        lastActiveAt: now,
        ...(finished ? { status: "completed" as const, endedAt: now } : {}),
      })
      .where(eq(studySessions.id, session.id));

    return { nextCursor, finished, nextDue: next.due };
  });
}

export async function abandonSession(db: Db, sessionId: string, now = new Date()): Promise<void> {
  await db
    .update(studySessions)
    .set({ status: "abandoned", endedAt: now })
    .where(eq(studySessions.id, sessionId));
}
