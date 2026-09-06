import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./helpers/database";
import {
  AsrUnavailableError,
  type AsrClient,
  type TranscriptionRequest,
  type TranscriptionResult,
} from "@/lib/speech/asr";

/**
 * The speaking exercise against a real database and filesystem, with a stub
 * recogniser. What matters here is that the recording survives whatever the
 * recogniser does — including being down.
 */
class StubAsr implements AsrClient {
  readonly engine = "stub";
  transcript = "Dober dan";
  available = true;
  mode: "ok" | "unavailable" | "error" = "ok";
  calls: TranscriptionRequest[] = [];

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    this.calls.push(request);
    if (this.mode === "unavailable") {
      throw new AsrUnavailableError("speech recognition is still starting up");
    }
    if (this.mode === "error") throw new Error("model exploded");
    return {
      text: this.transcript,
      language: "sl",
      durationSeconds: 1.5,
      segments: [],
      engine: this.engine,
      model: "stub-medium",
    };
  }
}

let database: TestDatabase;
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let attempts: typeof import("@/lib/speech/attempts");
let storage: typeof import("@/lib/audio/storage");
let drizzle: typeof import("drizzle-orm");

let userId: string;
let cardId: string;
let asr: StubAsr;

const AUDIO = Buffer.from("fake webm bytes, but bytes all the same");

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  process.env.SESSION_SECRET = "integration-test-secret-that-is-long-enough";
  process.env.MEDIA_ROOT = await mkdtemp(path.join(tmpdir(), "slo-speech-"));

  db = (await import("@/db/client")).db;
  schema = await import("@/db/schema");
  attempts = await import("@/lib/speech/attempts");
  storage = await import("@/lib/audio/storage");
  drizzle = await import("drizzle-orm");

  asr = new StubAsr();

  const [user] = await db
    .insert(schema.users)
    .values({ email: "speaker@test.local", displayName: "Lernende", role: "learner" })
    .returning({ id: schema.users.id });
  userId = user!.id;

  const [phrase] = await db
    .insert(schema.phrases)
    .values({
      slovene: "Dober dan",
      sloveneNormalized: "dober dan",
      german: "Guten Tag",
      status: "active",
      source: "seed",
    })
    .returning({ id: schema.phrases.id });

  const [card] = await db
    .insert(schema.cards)
    .values({ userId, phraseId: phrase!.id, exerciseType: "speaking" })
    .returning({ id: schema.cards.id });
  cardId = card!.id;
});

afterAll(async () => {
  await database?.stop();
});

describe("recording an attempt", () => {
  it("stores the audio, transcribes it, and scores it", async () => {
    const result = await attempts.recordSpeechAttempt(db, {
      userId,
      cardId,
      targetText: "Dober dan",
      audio: AUDIO,
      mimeType: "audio/webm",
      durationMs: 1500,
      client: asr,
    });

    expect(result.status).toBe("scored");
    expect(result.transcript).toBe("Dober dan");
    expect(result.score?.band).toBe("good");
    expect(result.score?.suggestedRating).toBe("good");

    const [row] = await db
      .select()
      .from(schema.speechAttempts)
      .where(drizzle.eq(schema.speechAttempts.id, result.attemptId));

    expect(row?.status).toBe("scored");
    expect(row?.band).toBe("good");
    expect(row?.engineModel).toBe("stub-medium");
    expect(row?.audioPath).toMatch(/^attempts\/\d{4}-\d{2}\/[0-9a-f-]{36}\.webm$/);
    // Every attempt is kept so the teacher can listen to them later.
    expect(await storage.mediaExists(row!.audioPath)).toBe(true);
  });

  it("returns a word-level diff so she can see what differed", async () => {
    asr.transcript = "Dober dan gospa";
    const result = await attempts.recordSpeechAttempt(db, {
      userId,
      cardId,
      targetText: "Dober dan",
      audio: AUDIO,
      mimeType: "audio/webm",
      client: asr,
    });

    expect(result.diff).toEqual([
      { kind: "same", text: "dober" },
      { kind: "same", text: "dan" },
      { kind: "extra", text: "gospa" },
    ]);
    asr.transcript = "Dober dan";
  });

  it("suggests a lower rating when the recogniser heard something else", async () => {
    asr.transcript = "krompir in solata";
    const result = await attempts.recordSpeechAttempt(db, {
      userId,
      cardId,
      targetText: "Dober dan",
      audio: AUDIO,
      mimeType: "audio/webm",
      client: asr,
    });
    expect(result.score?.band).toBe("off");
    expect(result.score?.suggestedRating).toBe("again");
    asr.transcript = "Dober dan";
  });
});

describe("when the recogniser is unavailable", () => {
  /**
   * The rule from the brief: speaking degrades to self-assessment rather than
   * crashing, and the recording is never lost.
   */
  it("keeps the recording and leaves the attempt pending", async () => {
    asr.mode = "unavailable";

    const result = await attempts.recordSpeechAttempt(db, {
      userId,
      cardId,
      targetText: "Dober dan",
      audio: AUDIO,
      mimeType: "audio/webm",
      client: asr,
    });

    expect(result.status).toBe("pending");
    expect(result.score).toBeNull();
    expect(result.reason).toMatch(/starting up/);

    const [row] = await db
      .select()
      .from(schema.speechAttempts)
      .where(drizzle.eq(schema.speechAttempts.id, result.attemptId));
    expect(row?.status).toBe("pending");
    expect(await storage.mediaExists(row!.audioPath)).toBe(true);

    asr.mode = "ok";
  });

  it("scores the waiting attempts once it is back", async () => {
    const before = await db
      .select()
      .from(schema.speechAttempts)
      .where(drizzle.eq(schema.speechAttempts.status, "pending"));
    expect(before.length).toBeGreaterThan(0);

    const summary = await attempts.scorePendingAttempts(db, { client: asr });
    expect(summary.scored).toBe(before.length);

    const after = await db
      .select()
      .from(schema.speechAttempts)
      .where(drizzle.eq(schema.speechAttempts.status, "pending"));
    expect(after).toHaveLength(0);
  });

  it("reports how many are waiting without pretending to score them", async () => {
    asr.mode = "unavailable";
    await attempts.recordSpeechAttempt(db, {
      userId,
      cardId,
      targetText: "Dober dan",
      audio: AUDIO,
      mimeType: "audio/webm",
      client: asr,
    });

    asr.available = false;
    const summary = await attempts.scorePendingAttempts(db, { client: asr });
    expect(summary.scored).toBe(0);
    expect(summary.stillPending).toBe(1);

    asr.available = true;
    asr.mode = "ok";
    await attempts.scorePendingAttempts(db, { client: asr });
  });

  it("marks a genuine failure as failed rather than retrying it forever", async () => {
    asr.mode = "error";
    const result = await attempts.recordSpeechAttempt(db, {
      userId,
      cardId,
      targetText: "Dober dan",
      audio: AUDIO,
      mimeType: "audio/webm",
      client: asr,
    });

    expect(result.status).toBe("failed");

    const [row] = await db
      .select()
      .from(schema.speechAttempts)
      .where(drizzle.eq(schema.speechAttempts.id, result.attemptId));
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toContain("exploded");
    // Still kept: the teacher can listen even when scoring broke.
    expect(await storage.mediaExists(row!.audioPath)).toBe(true);

    asr.mode = "ok";
  });
});

describe("the rating stays hers", () => {
  it("records when she overruled the suggestion", async () => {
    const service = await import("@/lib/session/service");

    asr.transcript = "nekaj čisto drugega";
    const attempt = await attempts.recordSpeechAttempt(db, {
      userId,
      cardId,
      targetText: "Dober dan",
      audio: AUDIO,
      mimeType: "audio/webm",
      client: asr,
    });
    expect(attempt.score?.suggestedRating).toBe("again");

    const session = await service.startOrResumeSession(db, userId);
    await service.submitReview(db, {
      userId,
      sessionId: session.sessionId,
      cardId,
      // "Das war eigentlich richtig" — she disagrees with the recogniser.
      rating: "good",
      ratingSource: "overridden",
    });

    const [log] = await db
      .select()
      .from(schema.reviewLogs)
      .where(drizzle.eq(schema.reviewLogs.cardId, cardId))
      .orderBy(drizzle.desc(schema.reviewLogs.reviewedAt))
      .limit(1);

    expect(log?.rating).toBe("good");
    expect(log?.ratingSource).toBe("overridden");

    asr.transcript = "Dober dan";
  });

  it("keeps every attempt for the teacher to listen to", async () => {
    const all = await attempts.getAttemptsForCard(db, userId, cardId);
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const attempt of all) {
      expect(await storage.mediaExists(attempt.audioPath)).toBe(true);
    }
  });
});
