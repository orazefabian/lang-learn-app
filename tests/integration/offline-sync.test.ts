import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./helpers/database";

/**
 * Taking back an offline session.
 *
 * The dangerous failure here is not a lost answer, it is a double-applied one:
 * grading a card twice moves her schedule, silently and permanently. Most of
 * these tests are about that.
 */
let database: TestDatabase;
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let sync: typeof import("@/lib/offline/sync");
let bundle: typeof import("@/lib/offline/bundle");
let session: typeof import("@/lib/session/service");
let drizzle: typeof import("drizzle-orm");

let learnerId: string;
let sessionId: string;
let cardIds: string[] = [];

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  process.env.SESSION_SECRET = "integration-test-secret-that-is-long-enough";
  process.env.MEDIA_ROOT = await mkdtemp(path.join(tmpdir(), "slo-offline-"));

  db = (await import("@/db/client")).db;
  schema = await import("@/db/schema");
  sync = await import("@/lib/offline/sync");
  bundle = await import("@/lib/offline/bundle");
  session = await import("@/lib/session/service");
  drizzle = await import("drizzle-orm");

  const [learner] = await db
    .insert(schema.users)
    .values({ email: "lernende@test.local", displayName: "Ana", role: "learner" })
    .returning({ id: schema.users.id });
  learnerId = learner!.id;
  await db.insert(schema.userSettings).values({ userId: learnerId });

  const phrases = await db
    .insert(schema.phrases)
    .values(
      ["Dober dan!", "Kako si?", "Hvala lepa.", "Se vidiva!"].map((slovene, index) => ({
        slovene,
        sloveneNormalized: slovene.toLowerCase(),
        german: `Deutsch ${index}`,
        status: "active" as const,
        source: "seed" as const,
      })),
    )
    .returning({ id: schema.phrases.id });

  const created = await db
    .insert(schema.cards)
    .values(
      phrases.map((phrase) => ({
        userId: learnerId,
        phraseId: phrase.id,
        exerciseType: "recognition" as const,
        due: new Date("2026-09-01T08:00:00Z"),
      })),
    )
    .returning({ id: schema.cards.id });
  cardIds = created.map((card) => card.id);

  const started = await session.startOrResumeSession(db, learnerId);
  sessionId = started.sessionId;
});

afterAll(async () => {
  await database?.stop();
});

describe("the bundle", () => {
  it("carries the whole queue, answers included", async () => {
    const built = await bundle.buildOfflineBundle(db, learnerId);

    expect(built?.sessionId).toBe(sessionId);
    expect(built?.cards.length).toBeGreaterThan(0);
    // Offline there is nobody to ask for the answer later.
    expect(built?.cards[0]?.acceptableAnswers.length).toBeGreaterThan(0);
    expect(built?.builtAt).toBeTruthy();
  });

  it("lists each audio file once, however many cards want it", async () => {
    const built = await bundle.buildOfflineBundle(db, learnerId);
    const urls = built?.audioUrls ?? [];
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("syncing reviews", () => {
  it("applies a queued answer and records that it came from offline", async () => {
    const reviewedAt = new Date("2026-09-02T19:30:00Z");
    const outcome = await sync.syncReviews(db, {
      userId: learnerId,
      reviews: [
        {
          clientEventId: "event-alpha-0001",
          sessionId,
          cardId: cardIds[0]!,
          rating: "good",
          reviewedAt,
        },
      ],
    });

    expect(outcome.applied).toBe(1);
    expect(outcome.rejected).toEqual([]);

    const [log] = await db
      .select()
      .from(schema.reviewLogs)
      .where(drizzle.eq(schema.reviewLogs.clientEventId, "event-alpha-0001"));

    expect(log?.rating).toBe("good");
    // The moment she answered, not the moment the network came back.
    expect(log?.reviewedAt.toISOString()).toBe(reviewedAt.toISOString());
    expect(log?.syncedAt).not.toBeNull();
  });

  /** The one that matters: a retried sync must not move her schedule again. */
  it("ignores an event it has already applied", async () => {
    const before = await db
      .select()
      .from(schema.cards)
      .where(drizzle.eq(schema.cards.id, cardIds[0]!));

    const outcome = await sync.syncReviews(db, {
      userId: learnerId,
      reviews: [
        {
          clientEventId: "event-alpha-0001",
          sessionId,
          cardId: cardIds[0]!,
          rating: "good",
          reviewedAt: new Date("2026-09-02T19:30:00Z"),
        },
      ],
    });

    expect(outcome.applied).toBe(0);
    expect(outcome.duplicates).toBe(1);

    const after = await db
      .select()
      .from(schema.cards)
      .where(drizzle.eq(schema.cards.id, cardIds[0]!));

    expect(after[0]?.due.toISOString()).toBe(before[0]?.due.toISOString());
    expect(after[0]?.reps).toBe(before[0]?.reps);

    const logs = await db
      .select()
      .from(schema.reviewLogs)
      .where(drizzle.eq(schema.reviewLogs.clientEventId, "event-alpha-0001"));
    expect(logs).toHaveLength(1);
  });

  /**
   * FSRS grades from the previous state, so two answers to the same card have
   * to be replayed in the order she gave them.
   */
  it("replays out-of-order events oldest first", async () => {
    const card = cardIds[1]!;

    await sync.syncReviews(db, {
      userId: learnerId,
      reviews: [
        {
          clientEventId: "event-beta-second",
          sessionId,
          cardId: card,
          rating: "good",
          reviewedAt: new Date("2026-09-02T20:00:00Z"),
        },
        {
          clientEventId: "event-beta-first",
          sessionId,
          cardId: card,
          rating: "again",
          reviewedAt: new Date("2026-09-02T19:00:00Z"),
        },
      ],
    });

    const logs = await db
      .select()
      .from(schema.reviewLogs)
      .where(drizzle.eq(schema.reviewLogs.cardId, card))
      .orderBy(schema.reviewLogs.reviewedAt);

    expect(logs.map((log) => log.rating)).toEqual(["again", "good"]);
    // The second grade saw the state the first one produced.
    expect(logs[1]?.stability).not.toBe(logs[0]?.stability);
  });

  it("keeps going when one event in the batch is unusable", async () => {
    const outcome = await sync.syncReviews(db, {
      userId: learnerId,
      reviews: [
        {
          clientEventId: "event-gamma-bad",
          sessionId,
          cardId: "00000000-0000-4000-8000-000000000000",
          rating: "good",
          reviewedAt: new Date("2026-09-02T19:10:00Z"),
        },
        {
          clientEventId: "event-gamma-good",
          sessionId,
          cardId: cardIds[2]!,
          rating: "easy",
          reviewedAt: new Date("2026-09-02T19:20:00Z"),
        },
      ],
    });

    expect(outcome.applied).toBe(1);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]?.clientEventId).toBe("event-gamma-bad");

    const [applied] = await db
      .select()
      .from(schema.reviewLogs)
      .where(drizzle.eq(schema.reviewLogs.clientEventId, "event-gamma-good"));
    expect(applied?.rating).toBe("easy");
  });

  it("refuses a card belonging to somebody else", async () => {
    const [other] = await db
      .insert(schema.users)
      .values({ email: "lehrer@test.local", displayName: "Fabian", role: "teacher" })
      .returning({ id: schema.users.id });

    const outcome = await sync.syncReviews(db, {
      userId: other!.id,
      reviews: [
        {
          clientEventId: "event-delta-theft",
          sessionId,
          cardId: cardIds[3]!,
          rating: "easy",
          reviewedAt: new Date("2026-09-02T19:40:00Z"),
        },
      ],
    });

    expect(outcome.applied).toBe(0);
    expect(outcome.rejected[0]?.reason).toMatch(/another user/);
  });

  it("does nothing at all with an empty queue", async () => {
    const outcome = await sync.syncReviews(db, { userId: learnerId, reviews: [] });
    expect(outcome).toEqual({ applied: 0, duplicates: 0, rejected: [] });
  });
});

describe("recordings made offline", () => {
  it("reports which uploads the server already has", async () => {
    await db.insert(schema.speechAttempts).values({
      userId: learnerId,
      cardId: cardIds[0]!,
      targetText: "Dober dan!",
      audioPath: "attempts/x.webm",
      status: "pending",
      clientEventId: "speech-event-0001",
    });

    const known = await sync.knownSpeechEvents(db, learnerId, [
      "speech-event-0001",
      "speech-event-0002",
    ]);

    expect(known.has("speech-event-0001")).toBe(true);
    expect(known.has("speech-event-0002")).toBe(false);
  });

  /** Uploaded twice is a retry, not a second attempt at the phrase. */
  it("will not store the same recording twice", async () => {
    await expect(
      db.insert(schema.speechAttempts).values({
        userId: learnerId,
        cardId: cardIds[0]!,
        targetText: "Dober dan!",
        audioPath: "attempts/y.webm",
        status: "pending",
        clientEventId: "speech-event-0001",
      }),
    ).rejects.toThrow();
  });
});
