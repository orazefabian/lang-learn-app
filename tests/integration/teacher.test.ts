import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./helpers/database";

/**
 * The teacher area: capture, the content browser, and human recordings.
 *
 * The rule that matters most here is the one about priority — a phrase caught
 * at a family dinner joins the normal pile and gets no special treatment.
 */
let database: TestDatabase;
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let capture: typeof import("@/lib/teacher/capture");
let content: typeof import("@/lib/teacher/content");
let recordings: typeof import("@/lib/teacher/recordings");
let resolve: typeof import("@/lib/audio/resolve");
let storage: typeof import("@/lib/audio/storage");
let drizzle: typeof import("drizzle-orm");

let teacherId: string;
let learnerId: string;

const AUDIO = Buffer.from("pretend this is Oma saying dober tek");

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  process.env.SESSION_SECRET = "integration-test-secret-that-is-long-enough";
  process.env.MEDIA_ROOT = await mkdtemp(path.join(tmpdir(), "slo-teacher-"));

  db = (await import("@/db/client")).db;
  schema = await import("@/db/schema");
  capture = await import("@/lib/teacher/capture");
  content = await import("@/lib/teacher/content");
  recordings = await import("@/lib/teacher/recordings");
  resolve = await import("@/lib/audio/resolve");
  storage = await import("@/lib/audio/storage");
  drizzle = await import("drizzle-orm");

  const inserted = await db
    .insert(schema.users)
    .values([
      { email: "lehrer@test.local", displayName: "Fabian", role: "teacher" },
      { email: "lernende@test.local", displayName: "Lernende", role: "learner" },
    ])
    .returning({ id: schema.users.id, role: schema.users.role });

  teacherId = inserted.find((u) => u.role === "teacher")!.id;
  learnerId = inserted.find((u) => u.role === "learner")!.id;
  await db.insert(schema.userSettings).values({ userId: learnerId });
});

afterAll(async () => {
  await database?.stop();
});

describe("quick capture", () => {
  it("saves a phrase from the Slovene alone", async () => {
    const result = await capture.captureItem(db, teacherId, {
      slovene: "Naj ti tekne!",
    });

    expect(result.kind).toBe("phrase");
    expect(result.duplicate).toBe(false);

    const [row] = await db
      .select()
      .from(schema.phrases)
      .where(drizzle.eq(schema.phrases.id, result.id));
    expect(row?.slovene).toBe("Naj ti tekne!");
    expect(row?.source).toBe("teacher");
    // Teacher-captured content is live immediately; only AI drafts wait.
    expect(row?.status).toBe("active");
  });

  it("keeps the context note, which is the point of capturing at all", async () => {
    const result = await capture.captureItem(db, teacherId, {
      slovene: "Boš še?",
      german: "Willst du noch?",
      contextNote: "Was Oma sagt, wenn sie dir nachlegen will",
      tags: ["essen"],
    });

    const [row] = await db
      .select()
      .from(schema.phrases)
      .where(drizzle.eq(schema.phrases.id, result.id));
    expect(row?.contextNote).toBe("Was Oma sagt, wenn sie dir nachlegen will");
    expect(row?.tags).toContain("essen");
    expect(row?.tags).toContain("quick-capture");
  });

  it("files a single word as a word and a sentence as a phrase", async () => {
    const word = await capture.captureItem(db, teacherId, { slovene: "krompir" });
    const phrase = await capture.captureItem(db, teacherId, { slovene: "Kje je krompir?" });
    expect(word.kind).toBe("lexeme");
    expect(phrase.kind).toBe("phrase");
  });

  /** The brief cuts priority injection explicitly: no boost, no deadline. */
  it("puts captured items in the normal pile with no priority boost", async () => {
    const result = await capture.captureItem(db, teacherId, {
      slovene: "Pridi jest!",
      german: "Komm essen!",
    });
    expect(result.cardsCreated).toBeGreaterThan(0);

    const cards = await db
      .select()
      .from(schema.cards)
      .where(drizzle.eq(schema.cards.phraseId, result.id));

    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.userId).toBe(learnerId);
      expect(card.state).toBe("new");
      expect(card.suspended).toBe(false);
      // Due now, like every other new card — not before them.
      expect(card.due.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });

  it("fills in an existing item rather than duplicating it", async () => {
    const first = await capture.captureItem(db, teacherId, { slovene: "Dober tek!" });
    const second = await capture.captureItem(db, teacherId, {
      slovene: "dober tek!",
      german: "Guten Appetit!",
      contextNote: "Bevor alle anfangen",
    });

    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);

    const [row] = await db
      .select()
      .from(schema.phrases)
      .where(drizzle.eq(schema.phrases.id, first.id));
    expect(row?.german).toBe("Guten Appetit!");
    expect(row?.contextNote).toBe("Bevor alle anfangen");
  });

  it("refuses an empty capture", async () => {
    await expect(capture.captureItem(db, teacherId, { slovene: "   " })).rejects.toThrow(
      /required/,
    );
  });
});

describe("the content browser", () => {
  it("finds an item by its Slovene, its German or its note", async () => {
    for (const term of ["Boš še", "Willst du noch", "nachlegen"]) {
      const rows = await content.searchContent(db, { search: term });
      expect(rows.some((row) => row.slovene === "Boš še?"), term).toBe(true);
    }
  });

  /** Searching without diacritics has to work: they are hard to type. */
  it("finds a word typed without its diacritics", async () => {
    const rows = await content.searchContent(db, { search: "Bos se" });
    expect(rows.some((row) => row.slovene === "Boš še?")).toBe(true);
  });

  it("filters by kind, status and source", async () => {
    const words = await content.searchContent(db, { kind: "lexeme" });
    expect(words.every((row) => row.kind === "lexeme")).toBe(true);

    const mine = await content.searchContent(db, { source: "teacher" });
    expect(mine.every((row) => row.source === "teacher")).toBe(true);
    expect(mine.length).toBeGreaterThan(0);
  });

  it("can list only the items nobody has recorded yet", async () => {
    const rows = await content.searchContent(db, { missingHumanAudio: true });
    expect(rows.every((row) => row.humanAudioCount === 0)).toBe(true);
  });
});

describe("editing", () => {
  it("saves an edit and reports when the Slovene changed", async () => {
    const rows = await content.searchContent(db, { search: "Naj ti tekne" });
    const target = rows[0]!;

    const unchanged = await content.updateContentItem(db, target.kind, target.id, {
      german: "Lass es dir schmecken!",
    });
    expect(unchanged.textChanged).toBe(false);

    // Changed text means the cached audio no longer matches the words.
    const changed = await content.updateContentItem(db, target.kind, target.id, {
      slovene: "Naj ti tekne, draga!",
    });
    expect(changed.textChanged).toBe(true);

    const detail = await content.getContentItem(db, target.kind, target.id);
    expect(detail?.slovene).toBe("Naj ti tekne, draga!");
    expect(detail?.german).toBe("Lass es dir schmecken!");
    expect(detail?.contextNote).toBeNull();
  });

  /** Archiving hides an item; it never destroys her history. */
  it("suspends the cards when an item is archived, and restores them after", async () => {
    const rows = await content.searchContent(db, { search: "Pridi jest" });
    const target = rows[0]!;

    await content.setArchived(db, target.kind, target.id, true);

    let cards = await db
      .select()
      .from(schema.cards)
      .where(drizzle.eq(schema.cards.phraseId, target.id));
    expect(cards.every((card) => card.suspended)).toBe(true);
    expect((await content.getContentItem(db, target.kind, target.id))?.status).toBe("archived");

    await content.setArchived(db, target.kind, target.id, false);

    cards = await db
      .select()
      .from(schema.cards)
      .where(drizzle.eq(schema.cards.phraseId, target.id));
    expect(cards.every((card) => !card.suspended)).toBe(true);
    // The review history is untouched either way.
    expect(cards.length).toBeGreaterThan(0);
  });
});

describe("human recordings", () => {
  it("attaches a voice with a speaker label and stores the file", async () => {
    const rows = await content.searchContent(db, { search: "Boš še" });
    const target = rows[0]!;

    const asset = await recordings.addHumanRecording(db, {
      kind: target.kind,
      itemId: target.id,
      audio: AUDIO,
      mimeType: "audio/webm",
      speakerLabel: "Oma",
      createdBy: teacherId,
    });

    expect(await storage.mediaExists(asset.path)).toBe(true);

    const detail = await content.getContentItem(db, target.kind, target.id);
    expect(detail?.humanAudioCount).toBe(1);
    expect(detail?.audio[0]?.speakerLabel).toBe("Oma");
  });

  /** The whole reason the feature exists. */
  it("makes the recording win over the generated voice on her card", async () => {
    const rows = await content.searchContent(db, { search: "Boš še" });
    const target = rows[0]!;

    await db.insert(schema.mediaAssets).values({
      kind: "tts",
      phraseId: target.id,
      speakerLabel: "sl_SI-artur-medium",
      path: "tts/aa/generated.opus",
      mimeType: "audio/ogg",
    });

    const audio = await resolve.getAudioForItem(db, { phraseId: target.id });
    expect(audio[0]?.kind).toBe("human_recording");
    expect(audio[0]?.speakerLabel).toBe("Oma");
    expect(audio.map((a) => a.kind)).toContain("tts");
  });

  it("lets a second voice be moved to the front", async () => {
    const rows = await content.searchContent(db, { search: "Boš še" });
    const target = rows[0]!;

    const papa = await recordings.addHumanRecording(db, {
      kind: target.kind,
      itemId: target.id,
      audio: AUDIO,
      mimeType: "audio/webm",
      speakerLabel: "Papa",
      createdBy: teacherId,
    });

    await recordings.promoteRecording(db, papa.id);

    const audio = await resolve.getAudioForItem(db, { phraseId: target.id });
    expect(audio[0]?.speakerLabel).toBe("Papa");
    // Oma is still there as an alternate she can flick to.
    expect(audio.map((a) => a.speakerLabel)).toContain("Oma");
  });

  it("removes a recording and its file", async () => {
    const rows = await content.searchContent(db, { search: "Boš še" });
    const target = rows[0]!;
    const detail = await content.getContentItem(db, target.kind, target.id);
    const human = detail!.audio.find((asset) => asset.kind === "human_recording")!;

    await recordings.removeRecording(db, human.id);

    expect(await storage.mediaExists(human.path)).toBe(false);
    const after = await content.getContentItem(db, target.kind, target.id);
    expect(after?.audio.some((asset) => asset.id === human.id)).toBe(false);
  });

  it("will not delete generated audio through the recording controls", async () => {
    const rows = await content.searchContent(db, { search: "Boš še" });
    const detail = await content.getContentItem(db, rows[0]!.kind, rows[0]!.id);
    const tts = detail!.audio.find((asset) => asset.kind === "tts")!;

    await expect(recordings.removeRecording(db, tts.id)).rejects.toThrow(/human recordings/);
  });

  it("refuses a recording with no speaker label", async () => {
    const rows = await content.searchContent(db, { search: "Boš še" });
    await expect(
      recordings.addHumanRecording(db, {
        kind: rows[0]!.kind,
        itemId: rows[0]!.id,
        audio: AUDIO,
        mimeType: "audio/webm",
        speakerLabel: "  ",
        createdBy: teacherId,
      }),
    ).rejects.toThrow(/speaker label/);
  });

  it("refuses a file type that is not audio", async () => {
    const rows = await content.searchContent(db, { search: "Boš še" });
    await expect(
      recordings.addHumanRecording(db, {
        kind: rows[0]!.kind,
        itemId: rows[0]!.id,
        audio: AUDIO,
        mimeType: "application/pdf",
        speakerLabel: "Oma",
        createdBy: teacherId,
      }),
    ).rejects.toThrow(/unsupported/);
  });
});
