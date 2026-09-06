import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  cards,
  digestSnapshots,
  lessonProgress,
  lexemes,
  mediaAssets,
  phrases,
  questions,
  reviewLogs,
  speechAttempts,
  studySessions,
  users,
} from "@/db/schema";
import type { DigestPeriod } from "./schedule";

/**
 * The weekly digest.
 *
 * It exists so the teacher can steer what he adds next, which is the only
 * thing it is allowed to be. It reports what happened and never characterises
 * it: no "only two sessions this week", no streak, no target she missed. If
 * she did not study, the digest says when she last did and moves on — the one
 * thing it must never become is a nag he is expected to relay.
 */

export type StrugglingItem = {
  cardId: string;
  kind: "phrase" | "lexeme";
  itemId: string;
  slovene: string;
  german: string;
  contextNote: string | null;
  exerciseType: string;
  lapses: number;
  stability: number;
  reps: number;
  lastReviewAt: string | null;
  /** Whether anyone has recorded it yet — the obvious next action if not. */
  hasHumanAudio: boolean;
};

export type LowSpeechAttempt = {
  id: string;
  targetText: string;
  transcript: string | null;
  charSimilarity: number | null;
  band: string | null;
  createdAt: string;
  cardId: string | null;
};

export type OpenQuestion = {
  id: string;
  body: string | null;
  slovene: string;
  askedAt: string;
  ageDays: number;
};

export type DigestData = {
  period: { start: string; end: string };
  reviewed: {
    total: number;
    distinctCards: number;
    sessions: number;
    minutes: number;
    /** Days in the week on which anything at all was reviewed. */
    activeDays: number;
  };
  retention: {
    /** Reviews of cards that were already in the review state. */
    mature: number;
    recalled: number;
    rate: number | null;
  };
  learned: {
    newCardsStarted: number;
    lessonsCompleted: number;
    canSayTotal: number;
  };
  struggling: StrugglingItem[];
  speech: {
    attempts: number;
    scored: number;
    lowest: LowSpeechAttempt[];
  };
  openQuestions: OpenQuestion[];
  lastSessionAt: string | null;
  daysSinceLastSession: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Mastery threshold, shared with the progress view. */
const CAN_SAY_STABILITY = 7;

export async function buildDigest(
  db: Db,
  input: { subjectUserId: string; period: DigestPeriod; now?: Date },
): Promise<DigestData> {
  const { subjectUserId, period } = input;
  const now = input.now ?? new Date();

  const logs = await db
    .select({
      cardId: reviewLogs.cardId,
      rating: reviewLogs.rating,
      state: reviewLogs.state,
      reviewedAt: reviewLogs.reviewedAt,
      durationMs: reviewLogs.durationMs,
      studySessionId: reviewLogs.studySessionId,
    })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, subjectUserId),
        gte(reviewLogs.reviewedAt, period.start),
        lt(reviewLogs.reviewedAt, period.end),
      ),
    );

  const distinctCards = new Set(logs.map((log) => log.cardId));
  const sessions = new Set(
    logs.map((log) => log.studySessionId).filter((id): id is string => Boolean(id)),
  );
  const activeDays = new Set(logs.map((log) => log.reviewedAt.toISOString().slice(0, 10)));
  const durationMs = logs.reduce((sum, log) => sum + (log.durationMs ?? 0), 0);

  /*
   * Retention counts only reviews of cards that were already in the review
   * state. Learning-step repeats would otherwise flatter the number, and a
   * flattering number is useless for deciding what to teach next.
   */
  const mature = logs.filter((log) => log.state === "review");
  const recalled = mature.filter((log) => log.rating !== "again");

  const [newStarted] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, subjectUserId),
        eq(reviewLogs.state, "new"),
        gte(reviewLogs.reviewedAt, period.start),
        lt(reviewLogs.reviewedAt, period.end),
      ),
    );

  const [lessonsDone] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, subjectUserId),
        gte(lessonProgress.completedAt, period.start),
        lt(lessonProgress.completedAt, period.end),
      ),
    );

  const [canSay] = await db
    .select({ value: sql<number>`count(distinct ${cards.phraseId})::int` })
    .from(cards)
    .where(
      and(
        eq(cards.userId, subjectUserId),
        eq(cards.state, "review"),
        gte(cards.stability, CAN_SAY_STABILITY),
        inArray(cards.exerciseType, ["production", "speaking"]),
        sql`${cards.phraseId} is not null`,
      ),
    );

  const struggling = await findStruggling(db, subjectUserId);

  const attempts = await db
    .select()
    .from(speechAttempts)
    .where(
      and(
        eq(speechAttempts.userId, subjectUserId),
        gte(speechAttempts.createdAt, period.start),
        lt(speechAttempts.createdAt, period.end),
      ),
    );

  const scored = attempts.filter(
    (attempt) => attempt.status === "scored" && attempt.charSimilarity !== null,
  );
  const lowest = [...scored]
    .sort((a, b) => (a.charSimilarity ?? 1) - (b.charSimilarity ?? 1))
    .slice(0, 5)
    .map(
      (attempt): LowSpeechAttempt => ({
        id: attempt.id,
        targetText: attempt.targetText,
        transcript: attempt.transcript,
        charSimilarity: attempt.charSimilarity,
        band: attempt.band,
        createdAt: attempt.createdAt.toISOString(),
        cardId: attempt.cardId,
      }),
    );

  const openQuestions = await findOpenQuestions(db, subjectUserId, now);

  const [lastSession] = await db
    .select({ lastActiveAt: studySessions.lastActiveAt })
    .from(studySessions)
    .where(eq(studySessions.userId, subjectUserId))
    .orderBy(desc(studySessions.lastActiveAt))
    .limit(1);

  return {
    period: { start: period.start.toISOString(), end: period.end.toISOString() },
    reviewed: {
      total: logs.length,
      distinctCards: distinctCards.size,
      sessions: sessions.size,
      minutes: Math.round(durationMs / 60_000),
      activeDays: activeDays.size,
    },
    retention: {
      mature: mature.length,
      recalled: recalled.length,
      // No reviews means no rate, not a zero. A zero would read as a failure.
      rate: mature.length ? recalled.length / mature.length : null,
    },
    learned: {
      newCardsStarted: newStarted?.value ?? 0,
      lessonsCompleted: lessonsDone?.value ?? 0,
      canSayTotal: canSay?.value ?? 0,
    },
    struggling,
    speech: { attempts: attempts.length, scored: scored.length, lowest },
    openQuestions,
    lastSessionAt: lastSession?.lastActiveAt.toISOString() ?? null,
    daysSinceLastSession: lastSession
      ? Math.floor((now.getTime() - lastSession.lastActiveAt.getTime()) / DAY_MS)
      : null,
  };
}

/**
 * The ten hardest items.
 *
 * Ranked by lapses first, then by how little has stuck (stability), across her
 * whole deck rather than just this week — an item she has been failing for a
 * month does not stop mattering in a week she was away.
 *
 * Grouped by item, not by card: a phrase she keeps failing produces a
 * recognition card, a listening card and a speaking card, and a list showing
 * the same sentence three times would be a worse list.
 */
async function findStruggling(db: Db, userId: string, limit = 10): Promise<StrugglingItem[]> {
  const rows = await db
    .select({
      cardId: cards.id,
      lexemeId: cards.lexemeId,
      phraseId: cards.phraseId,
      exerciseType: cards.exerciseType,
      lapses: cards.lapses,
      stability: cards.stability,
      reps: cards.reps,
      lastReview: cards.lastReview,
    })
    .from(cards)
    .where(and(eq(cards.userId, userId), ne(cards.state, "new"), sql`${cards.reps} > 0`))
    .orderBy(desc(cards.lapses), asc(cards.stability))
    .limit(limit * 6);

  const byItem = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = row.phraseId ?? row.lexemeId;
    // A cloze card carries neither; its phrase is reached through the cloze
    // item, and the phrase itself will already be in the list if it is hard.
    if (!key) continue;
    if (!byItem.has(key)) byItem.set(key, row);
  }

  const worst = [...byItem.values()].slice(0, limit);
  if (!worst.length) return [];

  const phraseIds = worst.map((row) => row.phraseId).filter((id): id is string => Boolean(id));
  const lexemeIds = worst.map((row) => row.lexemeId).filter((id): id is string => Boolean(id));

  const phraseRows = phraseIds.length
    ? await db.select().from(phrases).where(inArray(phrases.id, phraseIds))
    : [];
  const lexemeRows = lexemeIds.length
    ? await db.select().from(lexemes).where(inArray(lexemes.id, lexemeIds))
    : [];

  const phraseById = new Map(phraseRows.map((row) => [row.id, row]));
  const lexemeById = new Map(lexemeRows.map((row) => [row.id, row]));

  const recorded = new Set<string>();
  if (phraseIds.length || lexemeIds.length) {
    const assets = await db
      .select({ phraseId: mediaAssets.phraseId, lexemeId: mediaAssets.lexemeId })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.kind, "human_recording"),
          or(
            phraseIds.length ? inArray(mediaAssets.phraseId, phraseIds) : sql`false`,
            lexemeIds.length ? inArray(mediaAssets.lexemeId, lexemeIds) : sql`false`,
          ),
        ),
      );
    for (const asset of assets) {
      if (asset.phraseId) recorded.add(asset.phraseId);
      if (asset.lexemeId) recorded.add(asset.lexemeId);
    }
  }

  return worst.flatMap((row): StrugglingItem[] => {
    const phrase = row.phraseId ? phraseById.get(row.phraseId) : undefined;
    const lexeme = row.lexemeId ? lexemeById.get(row.lexemeId) : undefined;
    const itemId = row.phraseId ?? row.lexemeId;
    if (!itemId || (!phrase && !lexeme)) return [];

    return [
      {
        cardId: row.cardId,
        kind: phrase ? "phrase" : "lexeme",
        itemId,
        slovene: phrase?.slovene ?? lexeme?.slovene ?? "",
        german: phrase?.german ?? lexeme?.german.join(", ") ?? "",
        contextNote: phrase?.contextNote ?? lexeme?.notes ?? null,
        exerciseType: row.exerciseType,
        lapses: row.lapses,
        stability: row.stability,
        reps: row.reps,
        lastReviewAt: row.lastReview?.toISOString() ?? null,
        hasHumanAudio: recorded.has(itemId),
      },
    ];
  });
}

async function findOpenQuestions(db: Db, userId: string, now: Date): Promise<OpenQuestion[]> {
  const rows = await db
    .select()
    .from(questions)
    .where(and(eq(questions.askedBy, userId), eq(questions.status, "open")))
    .orderBy(asc(questions.createdAt));

  if (!rows.length) return [];

  const phraseIds = rows.map((row) => row.phraseId).filter((id): id is string => Boolean(id));
  const lexemeIds = rows.map((row) => row.lexemeId).filter((id): id is string => Boolean(id));

  const phraseRows = phraseIds.length
    ? await db
        .select({ id: phrases.id, slovene: phrases.slovene })
        .from(phrases)
        .where(inArray(phrases.id, phraseIds))
    : [];
  const lexemeRows = lexemeIds.length
    ? await db
        .select({ id: lexemes.id, slovene: lexemes.slovene })
        .from(lexemes)
        .where(inArray(lexemes.id, lexemeIds))
    : [];

  const byId = new Map([
    ...phraseRows.map((row) => [row.id, row.slovene] as const),
    ...lexemeRows.map((row) => [row.id, row.slovene] as const),
  ]);

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    slovene: byId.get(row.phraseId ?? row.lexemeId ?? "") ?? "—",
    askedAt: row.createdAt.toISOString(),
    ageDays: Math.floor((now.getTime() - row.createdAt.getTime()) / DAY_MS),
  }));
}

export type Snapshot = {
  id: string;
  subjectUserId: string;
  subjectName: string;
  periodStart: Date;
  periodEnd: Date;
  data: DigestData;
  generatedAt: Date;
  emailedAt: Date | null;
};

/**
 * Stores a digest for a period, or returns the one already stored.
 *
 * The unique index on (subject, period start) is what makes the scheduler safe
 * to run as often as it likes: a second run in the same week is a no-op rather
 * than a second email.
 */
export async function saveSnapshot(
  db: Db,
  input: { subjectUserId: string; period: DigestPeriod; data: DigestData; replace?: boolean },
): Promise<{ id: string; created: boolean }> {
  if (input.replace) {
    const [updated] = await db
      .update(digestSnapshots)
      .set({ data: input.data, generatedAt: new Date() })
      .where(
        and(
          eq(digestSnapshots.subjectUserId, input.subjectUserId),
          eq(digestSnapshots.periodStart, input.period.start),
        ),
      )
      .returning({ id: digestSnapshots.id });
    if (updated) return { id: updated.id, created: false };
  }

  const [created] = await db
    .insert(digestSnapshots)
    .values({
      subjectUserId: input.subjectUserId,
      periodStart: input.period.start,
      periodEnd: input.period.end,
      data: input.data,
    })
    .onConflictDoNothing()
    .returning({ id: digestSnapshots.id });

  if (created) return { id: created.id, created: true };

  const [existing] = await db
    .select({ id: digestSnapshots.id })
    .from(digestSnapshots)
    .where(
      and(
        eq(digestSnapshots.subjectUserId, input.subjectUserId),
        eq(digestSnapshots.periodStart, input.period.start),
      ),
    )
    .limit(1);

  if (!existing) throw new Error("could not store the digest");
  return { id: existing.id, created: false };
}

async function hydrateSnapshots(
  db: Db,
  rows: (typeof digestSnapshots.$inferSelect)[],
): Promise<Snapshot[]> {
  if (!rows.length) return [];
  const subjectIds = [...new Set(rows.map((row) => row.subjectUserId))];
  const subjects = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, subjectIds));
  const nameById = new Map(subjects.map((row) => [row.id, row.displayName]));

  return rows.map((row) => ({
    id: row.id,
    subjectUserId: row.subjectUserId,
    subjectName: nameById.get(row.subjectUserId) ?? "—",
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    data: row.data as DigestData,
    generatedAt: row.generatedAt,
    emailedAt: row.emailedAt,
  }));
}

export async function listSnapshots(db: Db, limit = 12): Promise<Snapshot[]> {
  const rows = await db
    .select()
    .from(digestSnapshots)
    .orderBy(desc(digestSnapshots.periodStart))
    .limit(limit);
  return hydrateSnapshots(db, rows);
}

export async function getSnapshot(db: Db, id: string): Promise<Snapshot | null> {
  const rows = await db.select().from(digestSnapshots).where(eq(digestSnapshots.id, id)).limit(1);
  const [snapshot] = await hydrateSnapshots(db, rows);
  return snapshot ?? null;
}

export async function markEmailed(db: Db, id: string): Promise<void> {
  await db
    .update(digestSnapshots)
    .set({ emailedAt: new Date() })
    .where(and(eq(digestSnapshots.id, id), isNull(digestSnapshots.emailedAt)));
}
