import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { speechAttempts } from "@/db/schema";
import { attemptPath, extensionFor, readMedia, writeMedia } from "@/lib/audio/storage";
import { logger } from "@/lib/logger";
import { AsrUnavailableError, getAsrClient, type AsrClient } from "./asr";
import { diffWords, scoreSpeech, type SpeechScore, type WordDiffSegment } from "./scoring";

/**
 * The speaking exercise, end to end.
 *
 * Every attempt is stored — audio and transcript both — so the teacher can
 * listen to them later. Recording never depends on the recogniser being up: if
 * Whisper is unavailable the audio is kept and scored on the next sync, and the
 * exercise degrades to self-assessment rather than failing.
 */

export type AttemptResult = {
  attemptId: string;
  status: "scored" | "pending" | "failed";
  transcript: string | null;
  score: SpeechScore | null;
  diff: WordDiffSegment[];
  /** Why there is no score, when there is none. */
  reason?: string;
};

export type RecordAttemptInput = {
  userId: string;
  cardId: string | null;
  studySessionId?: string | null;
  targetText: string;
  audio: Buffer;
  mimeType: string;
  durationMs?: number;
  client?: AsrClient;
  now?: Date;
};

export async function recordSpeechAttempt(
  db: Db,
  input: RecordAttemptInput,
): Promise<AttemptResult> {
  const now = input.now ?? new Date();
  const client = input.client ?? getAsrClient();

  const id = randomUUID();
  const path = attemptPath(id, extensionFor(input.mimeType), now);
  await writeMedia(path, input.audio);

  const [attempt] = await db
    .insert(speechAttempts)
    .values({
      id,
      userId: input.userId,
      cardId: input.cardId,
      studySessionId: input.studySessionId ?? null,
      targetText: input.targetText,
      audioPath: path,
      mimeType: input.mimeType,
      durationMs: input.durationMs ?? null,
      status: "pending",
      engine: client.engine,
      createdAt: now,
    })
    .returning({ id: speechAttempts.id });

  if (!attempt) throw new Error("could not record the speech attempt");

  return scoreAttempt(db, attempt.id, { client, audio: input.audio, mimeType: input.mimeType });
}

/**
 * Transcribes and scores one stored attempt.
 *
 * Split out from recording so an attempt captured offline, or captured while
 * Whisper was down, can be scored later without re-uploading anything.
 */
export async function scoreAttempt(
  db: Db,
  attemptId: string,
  options: { client?: AsrClient; audio?: Buffer; mimeType?: string } = {},
): Promise<AttemptResult> {
  const client = options.client ?? getAsrClient();

  const [attempt] = await db
    .select()
    .from(speechAttempts)
    .where(eq(speechAttempts.id, attemptId))
    .limit(1);
  if (!attempt) throw new Error(`speech attempt ${attemptId} not found`);

  try {
    const audio = options.audio ?? (await readMedia(attempt.audioPath));
    const result = await client.transcribe({
      audio,
      mimeType: options.mimeType ?? attempt.mimeType ?? "audio/webm",
    });

    const score = scoreSpeech(attempt.targetText, result.text);

    await db
      .update(speechAttempts)
      .set({
        transcript: result.text,
        charSimilarity: score.charSimilarity,
        wordSimilarity: score.wordSimilarity,
        band: score.band,
        suggestedRating: score.suggestedRating,
        status: "scored",
        engine: result.engine,
        engineModel: result.model,
        durationMs: attempt.durationMs ?? Math.round(result.durationSeconds * 1000),
        scoredAt: new Date(),
        errorMessage: null,
      })
      .where(eq(speechAttempts.id, attemptId));

    return {
      attemptId,
      status: "scored",
      transcript: result.text,
      score,
      diff: diffWords(attempt.targetText, result.text),
    };
  } catch (error) {
    const unavailable = error instanceof AsrUnavailableError;
    const reason = error instanceof Error ? error.message : String(error);

    if (!unavailable) logger.error({ err: error, attemptId }, "speech scoring failed");

    await db
      .update(speechAttempts)
      .set({
        // Unavailable is retryable and stays pending; anything else is a real
        // failure and should not be retried forever.
        status: unavailable ? "pending" : "failed",
        errorMessage: reason.slice(0, 500),
      })
      .where(eq(speechAttempts.id, attemptId));

    return {
      attemptId,
      status: unavailable ? "pending" : "failed",
      transcript: null,
      score: null,
      diff: [],
      reason,
    };
  }
}

/**
 * Scores attempts that are still waiting, oldest first. Called after an offline
 * session syncs and by anything that wants to catch up once Whisper is back.
 */
export async function scorePendingAttempts(
  db: Db,
  options: { limit?: number; client?: AsrClient } = {},
): Promise<{ scored: number; stillPending: number; failed: number }> {
  const client = options.client ?? getAsrClient();
  const summary = { scored: 0, stillPending: 0, failed: 0 };

  if (!(await client.isAvailable())) {
    const [row] = await db
      .select({ value: count() })
      .from(speechAttempts)
      .where(eq(speechAttempts.status, "pending"));
    summary.stillPending = row?.value ?? 0;
    return summary;
  }

  const pending = await db
    .select({ id: speechAttempts.id })
    .from(speechAttempts)
    .where(eq(speechAttempts.status, "pending"))
    .orderBy(asc(speechAttempts.createdAt))
    .limit(options.limit ?? 50);

  for (const row of pending) {
    const result = await scoreAttempt(db, row.id, { client });
    if (result.status === "scored") summary.scored += 1;
    else if (result.status === "pending") summary.stillPending += 1;
    else summary.failed += 1;
  }

  return summary;
}

/** The attempts for one card in the order they were made — the teacher's listening list. */
export async function getAttemptsForCard(db: Db, userId: string, cardId: string) {
  return db
    .select()
    .from(speechAttempts)
    .where(and(eq(speechAttempts.userId, userId), eq(speechAttempts.cardId, cardId)))
    .orderBy(asc(speechAttempts.createdAt));
}
