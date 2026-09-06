import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./helpers/database";

/**
 * The "Verstehe ich nicht" round trip.
 *
 * Two rules matter most: asking must not interrupt her session, and the answer
 * has to stay on the item afterwards rather than being a one-off message.
 */
let database: TestDatabase;
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let questionsService: typeof import("@/lib/questions/service");
let sessionService: typeof import("@/lib/session/service");
let resolve: typeof import("@/lib/audio/resolve");
let storage: typeof import("@/lib/audio/storage");
let drizzle: typeof import("drizzle-orm");

let learnerId: string;
let teacherId: string;
let phraseId: string;
let recognitionCardId: string;
let listeningCardId: string;

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  process.env.SESSION_SECRET = "integration-test-secret-that-is-long-enough";
  process.env.MEDIA_ROOT = await mkdtemp(path.join(tmpdir(), "slo-questions-"));

  db = (await import("@/db/client")).db;
  schema = await import("@/db/schema");
  questionsService = await import("@/lib/questions/service");
  sessionService = await import("@/lib/session/service");
  resolve = await import("@/lib/audio/resolve");
  storage = await import("@/lib/audio/storage");
  drizzle = await import("drizzle-orm");

  const users = await db
    .insert(schema.users)
    .values([
      { email: "lernende@test.local", displayName: "Lernende", role: "learner" },
      { email: "lehrer@test.local", displayName: "Fabian", role: "teacher" },
    ])
    .returning({ id: schema.users.id, role: schema.users.role });
  learnerId = users.find((u) => u.role === "learner")!.id;
  teacherId = users.find((u) => u.role === "teacher")!.id;
  await db.insert(schema.userSettings).values({ userId: learnerId });

  const [phrase] = await db
    .insert(schema.phrases)
    .values({
      slovene: "Rada bi kavo.",
      sloveneNormalized: "rada bi kavo.",
      german: "Ich hätte gern einen Kaffee.",
      status: "active",
      source: "seed",
    })
    .returning({ id: schema.phrases.id });
  phraseId = phrase!.id;

  const cards = await db
    .insert(schema.cards)
    .values([
      { userId: learnerId, phraseId, exerciseType: "recognition" },
      { userId: learnerId, phraseId, exerciseType: "listening" },
    ])
    .returning({ id: schema.cards.id, exerciseType: schema.cards.exerciseType });
  recognitionCardId = cards.find((c) => c.exerciseType === "recognition")!.id;
  listeningCardId = cards.find((c) => c.exerciseType === "listening")!.id;
});

afterAll(async () => {
  await database?.stop();
});

describe("asking", () => {
  it("files a question with her text and the card it came from", async () => {
    const { id } = await questionsService.askQuestion(db, {
      askedBy: learnerId,
      cardId: recognitionCardId,
      body: "Warum kavo und nicht kava?",
    });

    const [row] = await db
      .select()
      .from(schema.questions)
      .where(drizzle.eq(schema.questions.id, id));

    expect(row?.status).toBe("open");
    expect(row?.body).toBe("Warum kavo und nicht kava?");
    expect(row?.cardId).toBe(recognitionCardId);
    // Denormalised so the answer outlives the card.
    expect(row?.phraseId).toBe(phraseId);
  });

  /** Sometimes there are no words for what is confusing. */
  it("accepts a question with no text at all", async () => {
    const { id } = await questionsService.askQuestion(db, {
      askedBy: learnerId,
      cardId: listeningCardId,
    });

    const [row] = await db
      .select()
      .from(schema.questions)
      .where(drizzle.eq(schema.questions.id, id));
    expect(row?.body).toBeNull();
    expect(row?.status).toBe("open");
  });

  it("refuses a question about someone else's card", async () => {
    await expect(
      questionsService.askQuestion(db, { askedBy: teacherId, cardId: recognitionCardId }),
    ).rejects.toThrow(/another user/);
  });

  it("counts the open ones for the inbox badge", async () => {
    const counts = await questionsService.getInboxCounts(db);
    expect(counts.open).toBe(2);
    expect(counts.answered).toBe(0);
  });
});

describe("the inbox", () => {
  it("shows what she was looking at and which exercise it was", async () => {
    const inbox = await questionsService.listInbox(db, { status: "open" });
    const withText = inbox.find((q) => q.body?.startsWith("Warum"));

    expect(withText?.item.slovene).toBe("Rada bi kavo.");
    expect(withText?.item.german).toBe("Ich hätte gern einen Kaffee.");
    expect(withText?.exerciseType).toBe("recognition");
    expect(withText?.askedByName).toBe("Lernende");
  });
});

describe("answering", () => {
  it("stores a text answer and marks the question answered", async () => {
    const inbox = await questionsService.listInbox(db, { status: "open" });
    const target = inbox.find((q) => q.body?.startsWith("Warum"))!;

    await questionsService.answerQuestion(db, {
      questionId: target.id,
      answeredBy: teacherId,
      text: "Nach „rada bi“ steht der Akkusativ: kava wird zu kavo.",
    });

    const [row] = await db
      .select()
      .from(schema.questions)
      .where(drizzle.eq(schema.questions.id, target.id));

    expect(row?.status).toBe("answered");
    expect(row?.answerText).toContain("Akkusativ");
    expect(row?.answeredBy).toBe(teacherId);
    expect(row?.answeredAt).not.toBeNull();
  });

  it("notifies her that it was answered", async () => {
    const notifications = await db
      .select()
      .from(schema.notifications)
      .where(drizzle.eq(schema.notifications.userId, learnerId));

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.kind).toBe("question_answered");
    expect(notifications[0]?.readAt).toBeNull();
  });

  it("stores a voice note answer", async () => {
    const inbox = await questionsService.listInbox(db, { status: "open" });
    const target = inbox[0]!;

    await questionsService.answerQuestion(db, {
      questionId: target.id,
      answeredBy: teacherId,
      audio: { data: Buffer.from("a spoken explanation"), mimeType: "audio/webm" },
    });

    const answers = await questionsService.getAnswersForItem(db, { phraseId });
    const withAudio = answers.find((answer) => answer.answerAudioPath);
    expect(withAudio?.answerAudioPath).toMatch(/^recordings\//);
    expect(await storage.mediaExists(withAudio!.answerAudioPath as string)).toBe(true);
  });

  /**
   * The trap this avoids: an answer is an explanation, not a model
   * pronunciation. If it were attached to the phrase, her listening cards would
   * start playing the teacher explaining the accusative.
   */
  it("keeps answer audio out of the item's pronunciation voices", async () => {
    const audio = await resolve.getAudioForItem(db, { phraseId });
    expect(audio).toEqual([]);

    const assets = await db
      .select()
      .from(schema.mediaAssets)
      .where(drizzle.eq(schema.mediaAssets.speakerLabel, "answer"));
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(asset.phraseId).toBeNull();
      expect(asset.lexemeId).toBeNull();
    }
  });

  it("refuses an answer that is neither text nor audio", async () => {
    const { id } = await questionsService.askQuestion(db, {
      askedBy: learnerId,
      cardId: recognitionCardId,
    });
    await expect(
      questionsService.answerQuestion(db, { questionId: id, answeredBy: teacherId }),
    ).rejects.toThrow(/text or a recording/);
  });
});

describe("the answer comes back to her", () => {
  /** The point of asking: it pays off every time she meets the item again. */
  it("shows on the card she asked from", async () => {
    const prompt = await sessionService.getCardPrompt(db, recognitionCardId);
    expect(prompt?.answers.length).toBeGreaterThan(0);
    expect(prompt?.answers.some((a) => a.answerText?.includes("Akkusativ"))).toBe(true);
  });

  it("shows on every other card for the same item too", async () => {
    const prompt = await sessionService.getCardPrompt(db, listeningCardId);
    expect(prompt?.answers.some((a) => a.answerText?.includes("Akkusativ"))).toBe(true);
  });

  it("survives the card being rebuilt", async () => {
    await db.delete(schema.cards).where(drizzle.eq(schema.cards.id, recognitionCardId));

    const [rebuilt] = await db
      .insert(schema.cards)
      .values({ userId: learnerId, phraseId, exerciseType: "recognition" })
      .returning({ id: schema.cards.id });

    const prompt = await sessionService.getCardPrompt(db, rebuilt!.id);
    expect(prompt?.answers.some((a) => a.answerText?.includes("Akkusativ"))).toBe(true);
  });

  it("surfaces as unseen until she looks", async () => {
    const unseen = await questionsService.getUnseenAnswers(db, learnerId);
    expect(unseen.length).toBeGreaterThan(0);

    await questionsService.markAnswersSeen(db, learnerId);

    expect(await questionsService.getUnseenAnswers(db, learnerId)).toEqual([]);
    const notifications = await db
      .select()
      .from(schema.notifications)
      .where(drizzle.eq(schema.notifications.userId, learnerId));
    expect(notifications.every((n) => n.readAt !== null)).toBe(true);
  });

  it("still lists every answer she has received after the badge clears", async () => {
    const answers = await questionsService.listAnswersFor(db, learnerId);
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((answer) => answer.status === "answered")).toBe(true);
  });

  it("shows as new again when the teacher revises an answer", async () => {
    const answers = await questionsService.listAnswersFor(db, learnerId);
    const target = answers[0]!;

    await questionsService.answerQuestion(db, {
      questionId: target.id,
      answeredBy: teacherId,
      text: "Genauer: nach „rada bi“ steht immer der Akkusativ.",
    });

    const unseen = await questionsService.getUnseenAnswers(db, learnerId);
    expect(unseen.some((answer) => answer.id === target.id)).toBe(true);
  });
});
