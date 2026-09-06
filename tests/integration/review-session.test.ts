import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./helpers/database";

/**
 * The review loop against a real Postgres: building a capped queue, grading a
 * card, writing the log, advancing the cursor, and resuming after the app is
 * closed mid-session.
 */
let database: TestDatabase;
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let service: typeof import("@/lib/session/service");
let cardsLib: typeof import("@/lib/srs/cards");
let drizzle: typeof import("drizzle-orm");

let learnerId: string;
let phraseIds: string[] = [];

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  process.env.SESSION_SECRET = "integration-test-secret-that-is-long-enough";

  db = (await import("@/db/client")).db;
  schema = await import("@/db/schema");
  service = await import("@/lib/session/service");
  cardsLib = await import("@/lib/srs/cards");
  drizzle = await import("drizzle-orm");

  const [learner] = await db
    .insert(schema.users)
    .values({
      email: "lernende@test.local",
      displayName: "Lernende",
      role: "learner",
      passwordHash: "unused",
    })
    .returning({ id: schema.users.id });
  learnerId = learner!.id;
  await db.insert(schema.userSettings).values({ userId: learnerId });

  const inserted = await db
    .insert(schema.phrases)
    .values(
      Array.from({ length: 30 }, (_, i) => ({
        slovene: `Fraza ${i}`,
        sloveneNormalized: `fraza ${i}`,
        german: `Phrase ${i}`,
        contextNote: i === 0 ? "Was Oma sagt, wenn sie dir Essen anbietet" : null,
        status: "active" as const,
        source: "seed" as const,
      })),
    )
    .returning({ id: schema.phrases.id });
  phraseIds = inserted.map((row) => row.id);
});

afterAll(async () => {
  await database?.stop();
});

describe("card generation", () => {
  it("creates one card per item and exercise type", async () => {
    const result = await cardsLib.createCardsForItems(db, learnerId, {
      phraseIds: phraseIds.slice(0, 5),
    });
    // Without Piper and Whisper configured, phrases yield recognition +
    // production; listening and speaking wait until those services exist.
    expect(cardsLib.availableExerciseTypes()).toEqual(["recognition", "production", "cloze"]);
    expect(result.created).toBe(10);
  });

  it("is safe to run again — a replayed lesson does not double the workload", async () => {
    const again = await cardsLib.createCardsForItems(db, learnerId, {
      phraseIds: phraseIds.slice(0, 5),
    });
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(10);
  });
});

describe("session flow", () => {
  it("starts a session and hands back the first card", async () => {
    const session = await service.startOrResumeSession(db, learnerId);
    expect(session.resumed).toBe(false);
    expect(session.queue.length).toBeGreaterThan(0);
    expect(session.cursor).toBe(0);

    const prompt = await service.getCardPrompt(db, session.queue[0] as string);
    expect(prompt).not.toBeNull();
    expect(prompt?.prompt.length).toBeGreaterThan(0);
    expect(prompt?.isNew).toBe(true);
  });

  it("shows the German side for production and the Slovene side for recognition", async () => {
    const [recognition] = await db
      .select({ id: schema.cards.id })
      .from(schema.cards)
      .where(
        drizzle.and(
          drizzle.eq(schema.cards.userId, learnerId),
          drizzle.eq(schema.cards.exerciseType, "recognition"),
        ),
      )
      .limit(1);
    const [production] = await db
      .select({ id: schema.cards.id })
      .from(schema.cards)
      .where(
        drizzle.and(
          drizzle.eq(schema.cards.userId, learnerId),
          drizzle.eq(schema.cards.exerciseType, "production"),
        ),
      )
      .limit(1);

    const recognitionPrompt = await service.getCardPrompt(db, recognition!.id);
    const productionPrompt = await service.getCardPrompt(db, production!.id);

    expect(recognitionPrompt?.prompt).toBe(recognitionPrompt?.slovene);
    expect(productionPrompt?.prompt).toBe(productionPrompt?.german);
    expect(productionPrompt?.answer).toBe(productionPrompt?.slovene);
  });

  it("carries the context note through to the card", async () => {
    const [card] = await db
      .select({ id: schema.cards.id })
      .from(schema.cards)
      .where(drizzle.eq(schema.cards.phraseId, phraseIds[0] as string))
      .limit(1);
    const prompt = await service.getCardPrompt(db, card!.id);
    expect(prompt?.contextNote).toBe("Was Oma sagt, wenn sie dir Essen anbietet");
  });

  it("grades a card, writes a log, and advances the cursor", async () => {
    const session = await service.startOrResumeSession(db, learnerId);
    const cardId = session.queue[session.cursor] as string;

    const before = await db
      .select()
      .from(schema.cards)
      .where(drizzle.eq(schema.cards.id, cardId))
      .limit(1);

    const result = await service.submitReview(db, {
      userId: learnerId,
      sessionId: session.sessionId,
      cardId,
      rating: "good",
      durationMs: 4200,
    });

    expect(result.nextCursor).toBe(session.cursor + 1);
    expect(result.nextDue.getTime()).toBeGreaterThan(Date.now());

    const [after] = await db
      .select()
      .from(schema.cards)
      .where(drizzle.eq(schema.cards.id, cardId))
      .limit(1);
    expect(after?.state).not.toBe("new");
    expect(after?.reps).toBe((before[0]?.reps ?? 0) + 1);
    expect(after?.lastReview).not.toBeNull();

    const logs = await db
      .select()
      .from(schema.reviewLogs)
      .where(drizzle.eq(schema.reviewLogs.cardId, cardId));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.rating).toBe("good");
    expect(logs[0]?.durationMs).toBe(4200);
    expect(logs[0]?.studySessionId).toBe(session.sessionId);
  });

  it("resumes where she left off instead of starting over", async () => {
    const first = await service.startOrResumeSession(db, learnerId);
    expect(first.resumed).toBe(true);
    expect(first.cursor).toBeGreaterThan(0);

    const second = await service.startOrResumeSession(db, learnerId);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.cursor).toBe(first.cursor);
    expect(second.queue).toEqual(first.queue);
  });

  it("refuses to grade a card belonging to someone else", async () => {
    const [other] = await db
      .insert(schema.users)
      .values({ email: "lehrer@test.local", displayName: "Lehrer", role: "teacher" })
      .returning({ id: schema.users.id });

    const session = await service.startOrResumeSession(db, learnerId);
    await expect(
      service.submitReview(db, {
        userId: other!.id,
        sessionId: session.sessionId,
        cardId: session.queue[session.cursor] as string,
        rating: "good",
      }),
    ).rejects.toThrow(/another user/);
  });

  it("completes the session once the queue runs out", async () => {
    const session = await service.startOrResumeSession(db, learnerId);
    for (let i = session.cursor; i < session.queue.length; i += 1) {
      const result = await service.submitReview(db, {
        userId: learnerId,
        sessionId: session.sessionId,
        cardId: session.queue[i] as string,
        rating: "good",
      });
      if (i === session.queue.length - 1) expect(result.finished).toBe(true);
    }

    const [row] = await db
      .select()
      .from(schema.studySessions)
      .where(drizzle.eq(schema.studySessions.id, session.sessionId))
      .limit(1);
    expect(row?.status).toBe("completed");
    expect(row?.endedAt).not.toBeNull();
  });
});

describe("the home screen never reports the raw backlog", () => {
  it("caps what it shows even with hundreds of cards due", async () => {
    // Every card the learner owns, dumped into the past.
    await cardsLib.createCardsForItems(db, learnerId, { phraseIds });
    await db
      .update(schema.cards)
      .set({ due: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), state: "review", stability: 5 })
      .where(drizzle.eq(schema.cards.userId, learnerId));

    const overview = await service.getSessionOverview(db, learnerId);
    const settings = await service.getSettings(db, learnerId);

    expect(overview.displayedDue).toBeLessThanOrEqual(settings.reviewCap);
    expect(overview.hasMoreThanShown).toBe(true);
  });

  it("builds a session no larger than the cap from that backlog", async () => {
    // The previous session finished, so this starts a fresh one.
    const session = await service.startOrResumeSession(db, learnerId);
    const settings = await service.getSettings(db, learnerId);
    expect(session.queue.length).toBeLessThanOrEqual(settings.reviewCap);
    expect(session.queue.length).toBeGreaterThan(0);
  });
});
