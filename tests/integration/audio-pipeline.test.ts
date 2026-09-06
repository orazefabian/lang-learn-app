import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./helpers/database";
import type { SynthesisRequest, SynthesisResult, TtsClient } from "@/lib/audio/tts";

/**
 * The audio pipeline against a real database and a real filesystem, with a
 * stub engine standing in for Piper. What is under test is the part this app
 * owns: hashing, caching, regeneration on edit, and human recordings winning.
 */
class StubTts implements TtsClient {
  readonly engine = "stub";
  calls: SynthesisRequest[] = [];
  available = true;

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    this.calls.push(request);
    // Distinct bytes per text, so a reused file is visibly the same one.
    return {
      audio: Buffer.from(`audio:${request.format}:${request.text}`.padEnd(64, ".")),
      mimeType: request.format === "mp3" ? "audio/mpeg" : "audio/ogg",
      voice: request.voice ?? "stub-voice",
    };
  }
}

let database: TestDatabase;
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let pipeline: typeof import("@/lib/audio/pipeline");
let storage: typeof import("@/lib/audio/storage");
let resolve: typeof import("@/lib/audio/resolve");
let drizzle: typeof import("drizzle-orm");

let phraseId: string;
let tts: StubTts;

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  process.env.SESSION_SECRET = "integration-test-secret-that-is-long-enough";
  process.env.MEDIA_ROOT = await mkdtemp(path.join(tmpdir(), "slo-audio-"));
  process.env.PIPER_VOICE = "sl_SI-artur-medium";

  db = (await import("@/db/client")).db;
  schema = await import("@/db/schema");
  pipeline = await import("@/lib/audio/pipeline");
  storage = await import("@/lib/audio/storage");
  resolve = await import("@/lib/audio/resolve");
  drizzle = await import("drizzle-orm");

  tts = new StubTts();

  const [phrase] = await db
    .insert(schema.phrases)
    .values({
      slovene: "Dober tek!",
      sloveneNormalized: "dober tek!",
      german: "Guten Appetit!",
      status: "active",
      source: "seed",
    })
    .returning({ id: schema.phrases.id });
  phraseId = phrase!.id;
});

afterAll(async () => {
  await database?.stop();
});

describe("generating audio", () => {
  it("synthesises Opus with an mp3 fallback and records the asset", async () => {
    const result = await pipeline.ensureTtsAudio(
      db,
      { kind: "phrase", id: phraseId, text: "Dober tek!" },
      { client: tts },
    );
    expect(result.status).toBe("created");

    const [asset] = await db
      .select()
      .from(schema.mediaAssets)
      .where(drizzle.eq(schema.mediaAssets.phraseId, phraseId));

    expect(asset?.kind).toBe("tts");
    expect(asset?.path).toMatch(/^tts\/[0-9a-f]{2}\/[0-9a-f]{64}\.opus$/);
    expect(asset?.fallbackPath).toMatch(/\.mp3$/);
    expect(await storage.mediaExists(asset!.path)).toBe(true);
    expect(await storage.mediaExists(asset!.fallbackPath as string)).toBe(true);
    expect(tts.calls.map((c) => c.format)).toEqual(["opus", "mp3"]);
  });

  /** Audio is made once, at content-creation time — never per request. */
  it("reuses existing audio instead of synthesising again", async () => {
    const before = tts.calls.length;
    const result = await pipeline.ensureTtsAudio(
      db,
      { kind: "phrase", id: phraseId, text: "Dober tek!" },
      { client: tts },
    );
    expect(result.status).toBe("reused");
    expect(tts.calls.length).toBe(before);
  });

  it("regenerates when the phrase is edited, and drops the stale asset", async () => {
    const [before] = await db
      .select()
      .from(schema.mediaAssets)
      .where(drizzle.eq(schema.mediaAssets.phraseId, phraseId));

    const result = await pipeline.ensureTtsAudio(
      db,
      { kind: "phrase", id: phraseId, text: "Dober tek in na zdravje!" },
      { client: tts },
    );
    expect(result.status).toBe("created");

    const assets = await db
      .select()
      .from(schema.mediaAssets)
      .where(drizzle.eq(schema.mediaAssets.phraseId, phraseId));

    // Exactly one current asset, pointing at a new path.
    expect(assets).toHaveLength(1);
    expect(assets[0]?.path).not.toBe(before?.path);
    expect(assets[0]?.contentHash).not.toBe(before?.contentHash);
  });

  it("skips empty text rather than synthesising silence", async () => {
    const result = await pipeline.ensureTtsAudio(
      db,
      { kind: "phrase", id: phraseId, text: "   " },
      { client: tts },
    );
    expect(result.status).toBe("skipped");
  });

  it("reports a clear reason when no engine is reachable", async () => {
    tts.available = false;
    const report = await pipeline.generateMissingAudio(db, { client: tts });
    expect(report.failures[0]?.reason).toMatch(/PIPER_URL/);
    tts.available = true;
  });
});

describe("what plays on a card", () => {
  it("prefers a human recording over the generated voice", async () => {
    await db.insert(schema.mediaAssets).values({
      kind: "human_recording",
      phraseId,
      speakerLabel: "Oma",
      path: "recordings/ab/oma.webm",
      mimeType: "audio/webm",
    });

    const audio = await resolve.getAudioForItem(db, { phraseId });
    expect(audio[0]?.kind).toBe("human_recording");
    expect(audio[0]?.speakerLabel).toBe("Oma");
    // The generated one stays available as an alternate.
    expect(audio.map((a) => a.kind)).toContain("tts");
  });

  it("attaches audio to the card prompt so a listening card has something to play", async () => {
    const service = await import("@/lib/session/service");

    const [user] = await db
      .insert(schema.users)
      .values({ email: "audio@test.local", displayName: "Lernende", role: "learner" })
      .returning({ id: schema.users.id });

    const [card] = await db
      .insert(schema.cards)
      .values({ userId: user!.id, phraseId, exerciseType: "listening" })
      .returning({ id: schema.cards.id });

    const prompt = await service.getCardPrompt(db, card!.id);

    // A listening card shows nothing at first: the audio is the whole prompt.
    expect(prompt?.prompt).toBe("");
    expect(prompt?.audio.length).toBeGreaterThan(0);
    expect(prompt?.audio[0]?.src).toMatch(/^\/api\/media\//);
    expect(prompt?.answer).toBe("Guten Appetit!");
    // The Slovene is still there for the reveal after she answers.
    expect(prompt?.slovene).toBe("Dober tek!");
  });
});

describe("batch generation", () => {
  it("covers every active item and is a no-op on a second pass", async () => {
    await db.insert(schema.phrases).values([
      {
        slovene: "Hvala lepa.",
        sloveneNormalized: "hvala lepa.",
        german: "Vielen Dank.",
        status: "active",
        source: "seed",
      },
      {
        slovene: "Se vidiva!",
        sloveneNormalized: "se vidiva!",
        german: "Wir sehen uns!",
        status: "active",
        source: "seed",
      },
    ]);

    const first = await pipeline.generateMissingAudio(db, { client: tts });
    expect(first.created).toBeGreaterThanOrEqual(2);
    expect(first.failed).toBe(0);

    const second = await pipeline.generateMissingAudio(db, { client: tts });
    expect(second.created).toBe(0);
    expect(second.reused).toBeGreaterThanOrEqual(3);
  });

  it("leaves drafts alone unless asked for them", async () => {
    await db.insert(schema.phrases).values({
      slovene: "Osnutek fraze.",
      sloveneNormalized: "osnutek fraze.",
      german: "Entwurfsphrase.",
      status: "draft",
      source: "ai",
    });

    const activeOnly = await pipeline.generateMissingAudio(db, { client: tts });
    expect(activeOnly.created).toBe(0);

    const withDrafts = await pipeline.generateMissingAudio(db, {
      client: tts,
      includeDrafts: true,
    });
    expect(withDrafts.created).toBe(1);
  });
});
