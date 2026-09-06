import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { currentUser } from "@/lib/auth";
import { syncReviews } from "@/lib/offline/sync";
import { logger } from "@/lib/logger";
import type { CardRating } from "@/lib/srs/scheduler";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  clientEventId: z.string().min(8).max(64),
  sessionId: z.string().uuid(),
  cardId: z.string().uuid(),
  rating: z.enum(["again", "hard", "good", "easy"]),
  reviewedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative().max(1000 * 60 * 60).optional(),
  ratingSource: z.enum(["manual", "auto_speech", "overridden"]).optional(),
});

const bodySchema = z.object({
  reviews: z.array(reviewSchema).max(500),
});

/**
 * Everything she answered while offline.
 *
 * The response tells the client exactly which events are settled, so it can
 * clear those and keep the rest. Duplicates count as settled: a retried sync
 * must be able to finish.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const outcome = await syncReviews(db, {
    userId: user.id,
    reviews: parsed.data.reviews.map((review) => ({
      clientEventId: review.clientEventId,
      sessionId: review.sessionId,
      cardId: review.cardId,
      rating: review.rating as CardRating,
      reviewedAt: new Date(review.reviewedAt),
      durationMs: review.durationMs,
      ratingSource: review.ratingSource,
    })),
  });

  logger.info(
    { userId: user.id, applied: outcome.applied, duplicates: outcome.duplicates },
    "offline reviews synced",
  );

  /*
   * Settled means "stop keeping this". Everything the server has now seen is
   * settled, rejections included: the usual cause of a rejection is a card that
   * no longer exists, and a queue that retries the same failure forever would
   * block every review behind it.
   */
  return NextResponse.json({
    applied: outcome.applied,
    duplicates: outcome.duplicates,
    rejected: outcome.rejected,
    settled: parsed.data.reviews.map((review) => review.clientEventId),
  });
}
