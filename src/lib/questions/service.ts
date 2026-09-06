import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  cards,
  lexemes,
  mediaAssets,
  notifications,
  phrases,
  questions,
  users,
} from "@/db/schema";
import { extensionFor, recordingPath, writeMedia } from "@/lib/audio/storage";

/**
 * "Verstehe ich nicht".
 *
 * She taps it on a card, optionally types what is confusing, and carries on —
 * asking must never interrupt a session. The question lands in the teacher's
 * inbox; his answer attaches to the item permanently and shows on that card
 * from then on, not just once.
 */

export type AskInput = {
  askedBy: string;
  cardId: string;
  body?: string;
};

export async function askQuestion(db: Db, input: AskInput): Promise<{ id: string }> {
  const [card] = await db.select().from(cards).where(eq(cards.id, input.cardId)).limit(1);
  if (!card) throw new Error("card not found");
  if (card.userId !== input.askedBy) throw new Error("card belongs to another user");

  // The item references are denormalised on purpose: cards get rebuilt, and an
  // answer should outlive the card that prompted the question.
  const [created] = await db
    .insert(questions)
    .values({
      askedBy: input.askedBy,
      cardId: card.id,
      lexemeId: card.lexemeId,
      phraseId: card.phraseId,
      body: input.body?.trim() || null,
      status: "open",
    })
    .returning({ id: questions.id });

  if (!created) throw new Error("could not file the question");
  return { id: created.id };
}

export type InboxQuestion = {
  id: string;
  body: string | null;
  status: "open" | "answered";
  createdAt: Date;
  answeredAt: Date | null;
  answerText: string | null;
  answerAudioPath: string | null;
  askedByName: string;
  /** What she was looking at. */
  item: {
    kind: "phrase" | "lexeme" | "unknown";
    id: string | null;
    slovene: string;
    german: string;
    contextNote: string | null;
  };
  exerciseType: string | null;
};

async function hydrate(
  db: Db,
  rows: (typeof questions.$inferSelect)[],
): Promise<InboxQuestion[]> {
  const phraseIds = rows.map((r) => r.phraseId).filter((id): id is string => Boolean(id));
  const lexemeIds = rows.map((r) => r.lexemeId).filter((id): id is string => Boolean(id));
  const cardIds = rows.map((r) => r.cardId).filter((id): id is string => Boolean(id));
  const mediaIds = rows.map((r) => r.answerMediaId).filter((id): id is string => Boolean(id));
  const askerIds = [...new Set(rows.map((r) => r.askedBy))];

  const askerRows = askerIds.length
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, askerIds))
    : [];
  const askerById = new Map(askerRows.map((row) => [row.id, row.displayName]));

  const phraseRows = phraseIds.length
    ? await db.select().from(phrases).where(inArray(phrases.id, phraseIds))
    : [];
  const lexemeRows = lexemeIds.length
    ? await db.select().from(lexemes).where(inArray(lexemes.id, lexemeIds))
    : [];
  const cardRows = cardIds.length
    ? await db
        .select({ id: cards.id, exerciseType: cards.exerciseType })
        .from(cards)
        .where(inArray(cards.id, cardIds))
    : [];
  const mediaRows = mediaIds.length
    ? await db
        .select({ id: mediaAssets.id, path: mediaAssets.path })
        .from(mediaAssets)
        .where(inArray(mediaAssets.id, mediaIds))
    : [];

  const phraseById = new Map(phraseRows.map((row) => [row.id, row]));
  const lexemeById = new Map(lexemeRows.map((row) => [row.id, row]));
  const cardById = new Map(cardRows.map((row) => [row.id, row]));
  const mediaById = new Map(mediaRows.map((row) => [row.id, row]));

  return rows.map((row): InboxQuestion => {
    const phrase = row.phraseId ? phraseById.get(row.phraseId) : undefined;
    const lexeme = row.lexemeId ? lexemeById.get(row.lexemeId) : undefined;

    return {
      id: row.id,
      body: row.body,
      status: row.status,
      createdAt: row.createdAt,
      answeredAt: row.answeredAt,
      answerText: row.answerText,
      answerAudioPath: row.answerMediaId
        ? (mediaById.get(row.answerMediaId)?.path ?? null)
        : null,
      askedByName: askerById.get(row.askedBy) ?? "—",
      item: phrase
        ? {
            kind: "phrase",
            id: phrase.id,
            slovene: phrase.slovene,
            german: phrase.german,
            contextNote: phrase.contextNote,
          }
        : lexeme
          ? {
              kind: "lexeme",
              id: lexeme.id,
              slovene: lexeme.slovene,
              german: lexeme.german.join(", "),
              contextNote: lexeme.notes,
            }
          : { kind: "unknown", id: null, slovene: "—", german: "—", contextNote: null },
      exerciseType: row.cardId ? (cardById.get(row.cardId)?.exerciseType ?? null) : null,
    };
  });
}

export async function listInbox(
  db: Db,
  options: { status?: "open" | "answered" | "all"; limit?: number } = {},
): Promise<InboxQuestion[]> {
  const status = options.status ?? "open";

  const rows = await db
    .select()
    .from(questions)
    .where(status === "all" ? undefined : eq(questions.status, status))
    .orderBy(desc(questions.createdAt))
    .limit(options.limit ?? 50);

  return hydrate(db, rows);
}

export async function getInboxCounts(db: Db): Promise<{ open: number; answered: number }> {
  const [openRow] = await db
    .select({ value: count() })
    .from(questions)
    .where(eq(questions.status, "open"));
  const [answeredRow] = await db
    .select({ value: count() })
    .from(questions)
    .where(eq(questions.status, "answered"));

  return { open: openRow?.value ?? 0, answered: answeredRow?.value ?? 0 };
}

export type AnswerInput = {
  questionId: string;
  answeredBy: string;
  text?: string;
  audio?: { data: Buffer; mimeType: string; durationMs?: number };
};

export async function answerQuestion(db: Db, input: AnswerInput): Promise<void> {
  const text = input.text?.trim() || null;
  if (!text && !input.audio) throw new Error("an answer needs text or a recording");

  const [question] = await db
    .select()
    .from(questions)
    .where(eq(questions.id, input.questionId))
    .limit(1);
  if (!question) throw new Error("question not found");

  let answerMediaId: string | null = question.answerMediaId;

  if (input.audio) {
    const id = randomUUID();
    const path = recordingPath(id, extensionFor(input.audio.mimeType));
    const byteSize = await writeMedia(path, input.audio.data);

    /*
     * Deliberately not linked to the phrase or lexeme.
     *
     * An answer is an explanation, not a model pronunciation. Attaching it to
     * the item would put the teacher explaining the dative into the rotation of
     * voices her listening cards play back.
     */
    const [asset] = await db
      .insert(mediaAssets)
      .values({
        id,
        kind: "human_recording",
        lexemeId: null,
        phraseId: null,
        speakerLabel: "answer",
        path,
        mimeType: input.audio.mimeType,
        byteSize,
        durationMs: input.audio.durationMs ?? null,
        priority: 0,
        createdBy: input.answeredBy,
      })
      .returning({ id: mediaAssets.id });

    answerMediaId = asset?.id ?? null;
  }

  const answeredAt = new Date();

  await db
    .update(questions)
    .set({
      answerText: text ?? question.answerText,
      answerMediaId,
      answeredBy: input.answeredBy,
      answeredAt,
      status: "answered",
      // A re-answer should show up as new again.
      seenAt: null,
    })
    .where(eq(questions.id, input.questionId));

  await db.insert(notifications).values({
    userId: question.askedBy,
    kind: "question_answered",
    payload: {
      questionId: question.id,
      phraseId: question.phraseId,
      lexemeId: question.lexemeId,
    },
  });
}

export type ItemAnswer = {
  questionId: string;
  question: string | null;
  answerText: string | null;
  answerAudioPath: string | null;
  answeredAt: Date | null;
};

/**
 * Answers attached to an item, shown on its card from then on.
 *
 * Keyed by the item rather than the card, so rebuilding a card — or meeting the
 * same phrase through a different exercise — still shows what he explained.
 */
export async function getAnswersForItem(
  db: Db,
  item: { phraseId?: string | null; lexemeId?: string | null },
): Promise<ItemAnswer[]> {
  const conditions = [];
  if (item.phraseId) conditions.push(eq(questions.phraseId, item.phraseId));
  if (item.lexemeId) conditions.push(eq(questions.lexemeId, item.lexemeId));
  if (!conditions.length) return [];

  const rows = await db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.status, "answered"),
        conditions.length === 1 ? conditions[0] : or(...conditions),
      ),
    )
    .orderBy(desc(questions.answeredAt));

  const mediaIds = rows.map((r) => r.answerMediaId).filter((id): id is string => Boolean(id));
  const mediaRows = mediaIds.length
    ? await db
        .select({ id: mediaAssets.id, path: mediaAssets.path })
        .from(mediaAssets)
        .where(inArray(mediaAssets.id, mediaIds))
    : [];
  const mediaById = new Map(mediaRows.map((row) => [row.id, row]));

  return rows.map((row) => ({
    questionId: row.id,
    question: row.body,
    answerText: row.answerText,
    answerAudioPath: row.answerMediaId
      ? (mediaById.get(row.answerMediaId)?.path ?? null)
      : null,
    answeredAt: row.answeredAt,
  }));
}

/** Every answer she has received, newest first. */
export async function listAnswersFor(
  db: Db,
  userId: string,
  limit = 50,
): Promise<InboxQuestion[]> {
  const rows = await db
    .select()
    .from(questions)
    .where(and(eq(questions.askedBy, userId), eq(questions.status, "answered")))
    .orderBy(desc(questions.answeredAt))
    .limit(limit);

  return hydrate(db, rows);
}

/** Answers she has not looked at yet — the home-screen nudge. */
export async function getUnseenAnswers(
  db: Db,
  userId: string,
): Promise<InboxQuestion[]> {
  const rows = await db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.askedBy, userId),
        eq(questions.status, "answered"),
        isNull(questions.seenAt),
      ),
    )
    .orderBy(desc(questions.answeredAt));

  return hydrate(db, rows);
}

export async function markAnswersSeen(db: Db, userId: string, ids?: string[]): Promise<void> {
  const now = new Date();
  await db
    .update(questions)
    .set({ seenAt: now })
    .where(
      and(
        eq(questions.askedBy, userId),
        eq(questions.status, "answered"),
        isNull(questions.seenAt),
        ...(ids?.length ? [inArray(questions.id, ids)] : []),
      ),
    );

  await db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.kind, "question_answered"),
        isNull(notifications.readAt),
      ),
    );
}

/** Open questions she has already asked about an item, so she is not asked twice. */
export async function hasOpenQuestion(
  db: Db,
  userId: string,
  cardId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(
        eq(questions.askedBy, userId),
        eq(questions.cardId, cardId),
        eq(questions.status, "open"),
      ),
    )
    .limit(1);
  return Boolean(row);
}
