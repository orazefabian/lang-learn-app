import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { cards, reviewLogs, speechAttempts, studySessions } from "@/db/schema";
import { logger } from "@/lib/logger";
import { submitReview } from "@/lib/session/service";
import type { CardRating } from "@/lib/srs/scheduler";

/**
 * Taking back what happened while she was offline.
 *
 * Two rules shape this file. Reviews are replayed **in the order she gave
 * them, with the timestamps she gave them** — FSRS schedules from the moment
 * of the answer, so replaying a Tuesday answer as though it happened on
 * Thursday would quietly corrupt the schedule. And every event carries an id
 * minted in the browser, so a sync that half-succeeds can be retried without
 * grading a card twice.
 */

export type QueuedReview = {
  clientEventId: string;
  sessionId: string;
  cardId: string;
  rating: CardRating;
  reviewedAt: Date;
  durationMs?: number;
  ratingSource?: "manual" | "auto_speech" | "overridden";
};

export type SyncOutcome = {
  applied: number;
  duplicates: number;
  rejected: { clientEventId: string; reason: string }[];
};

export async function syncReviews(
  db: Db,
  input: { userId: string; reviews: QueuedReview[] },
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { applied: 0, duplicates: 0, rejected: [] };
  if (!input.reviews.length) return outcome;

  // Oldest first: a card answered twice in one offline session has to be
  // graded in that order, or the second grade is computed from the wrong state.
  const ordered = [...input.reviews].sort(
    (a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime(),
  );

  const known = await db
    .select({ clientEventId: reviewLogs.clientEventId })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, input.userId),
        inArray(
          reviewLogs.clientEventId,
          ordered.map((review) => review.clientEventId),
        ),
      ),
    );
  const alreadyApplied = new Set(known.map((row) => row.clientEventId));

  for (const review of ordered) {
    if (alreadyApplied.has(review.clientEventId)) {
      outcome.duplicates += 1;
      continue;
    }

    try {
      await submitReview(db, {
        userId: input.userId,
        sessionId: review.sessionId,
        cardId: review.cardId,
        rating: review.rating,
        ratingSource: review.ratingSource ?? "manual",
        durationMs: review.durationMs,
        // The moment she answered, not the moment the network came back.
        now: review.reviewedAt,
        clientEventId: review.clientEventId,
        syncedAt: new Date(),
      });
      outcome.applied += 1;
      alreadyApplied.add(review.clientEventId);
    } catch (error) {
      const reason = (error as Error).message;
      /*
       * A rejected event is dropped, not retried forever. The usual cause is a
       * card or session that no longer exists — a queue that keeps failing on
       * the same item would block every later review behind it.
       */
      if (/duplicate key|client_event_unique/i.test(reason)) {
        outcome.duplicates += 1;
        continue;
      }
      logger.warn({ err: error, clientEventId: review.clientEventId }, "offline review rejected");
      outcome.rejected.push({ clientEventId: review.clientEventId, reason });
    }
  }

  return outcome;
}

/** Which of these recordings the server already has. */
export async function knownSpeechEvents(
  db: Db,
  userId: string,
  clientEventIds: string[],
): Promise<Set<string>> {
  if (!clientEventIds.length) return new Set();
  const rows = await db
    .select({ clientEventId: speechAttempts.clientEventId })
    .from(speechAttempts)
    .where(
      and(
        eq(speechAttempts.userId, userId),
        inArray(speechAttempts.clientEventId, clientEventIds),
      ),
    );
  return new Set(rows.map((row) => row.clientEventId).filter((id): id is string => Boolean(id)));
}

/** Sessions she left open offline, so the client can resume the right one. */
export async function activeSessionFor(db: Db, userId: string): Promise<string | null> {
  const [session] = await db
    .select({ id: studySessions.id })
    .from(studySessions)
    .where(and(eq(studySessions.userId, userId), eq(studySessions.status, "active")))
    .limit(1);
  return session?.id ?? null;
}

/** Cards whose schedule the client's cached bundle no longer reflects. */
export async function cardsNeedingRefresh(
  db: Db,
  userId: string,
  cardIds: string[],
): Promise<string[]> {
  if (!cardIds.length) return [];
  const rows = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.userId, userId), inArray(cards.id, cardIds), eq(cards.suspended, true)));
  return rows.map((row) => row.id);
}
