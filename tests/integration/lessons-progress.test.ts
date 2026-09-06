import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./helpers/database";

/**
 * Lessons and the capability view against a real database.
 *
 * Two rules carry most of the weight here: finishing a lesson is what hands its
 * items to the scheduler, and progress is expressed as things she can say
 * rather than as a count of days.
 */
let database: TestDatabase;
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let lessonsService: typeof import("@/lib/lessons/service");
let progressService: typeof import("@/lib/progress/service");
let drizzle: typeof import("drizzle-orm");

let userId: string;
let lessonOneId: string;
let lessonTwoId: string;
let phraseIds: string[] = [];

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  process.env.SESSION_SECRET = "integration-test-secret-that-is-long-enough";
  process.env.MEDIA_ROOT = await mkdtemp(path.join(tmpdir(), "slo-lessons-"));

  db = (await import("@/db/client")).db;
  schema = await import("@/db/schema");
  lessonsService = await import("@/lib/lessons/service");
  progressService = await import("@/lib/progress/service");
  drizzle = await import("drizzle-orm");

  const [user] = await db
    .insert(schema.users)
    .values({ email: "lessons@test.local", displayName: "Lernende", role: "learner" })
    .returning({ id: schema.users.id });
  userId = user!.id;
  await db.insert(schema.userSettings).values({ userId });

  const [unit] = await db
    .insert(schema.units)
    .values({ slug: "erste-begegnung", titleDe: "Erste Begegnung", position: 1 })
    .returning({ id: schema.units.id });

  const [note] = await db
    .insert(schema.grammarNotes)
    .values({
      slug: "dvojina-grundlagen",
      titleDe: "Die Dvojina",
      bodyDe: "Slowenisch zählt bis zwei.",
      status: "active",
    })
    .returning({ id: schema.grammarNotes.id });

  const inserted = await db
    .insert(schema.phrases)
    .values([
      {
        slovene: "Dober dan!",
        sloveneNormalized: "dober dan!",
        german: "Guten Tag!",
        contextNote: "Die sichere Wahl.",
        status: "active",
        source: "seed",
      },
      {
        slovene: "Se vidiva!",
        sloveneNormalized: "se vidiva!",
        german: "Wir sehen uns!",
        tags: ["dvojina"],
        status: "active",
        source: "seed",
      },
    ])
    .returning({ id: schema.phrases.id });
  phraseIds = inserted.map((row) => row.id);

  const lessonRows = await db
    .insert(schema.lessons)
    .values([
      {
        unitId: unit!.id,
        slug: "gruessen",
        titleDe: "Grüßen",
        goalDe: "Du kannst jemanden begrüßen.",
        introDe: "**Živjo** ist das lockere Hallo.",
        position: 1,
        estimatedMinutes: 4,
        status: "active",
      },
      {
        unitId: unit!.id,
        slug: "zu-zweit",
        titleDe: "Zu zweit",
        position: 2,
        estimatedMinutes: 6,
        status: "active",
      },
    ])
    .returning({ id: schema.lessons.id });
  lessonOneId = lessonRows[0]!.id;
  lessonTwoId = lessonRows[1]!.id;

  await db.insert(schema.lessonItems).values([
    { lessonId: lessonOneId, phraseId: phraseIds[0] as string, position: 0 },
    { lessonId: lessonTwoId, phraseId: phraseIds[1] as string, position: 0 },
  ]);

  await db.insert(schema.grammarNoteLinks).values({ noteId: note!.id, lessonId: lessonTwoId });

  await db.insert(schema.clozeItems).values({
    phraseId: phraseIds[1] as string,
    position: 1,
    answer: "vidiva",
    answerNormalized: "vidiva",
    focusNumber: "dual",
    hintDe: "genau zwei",
    status: "active",
  });
});

afterAll(async () => {
  await database?.stop();
});

describe("the lesson list", () => {
  it("groups lessons under their unit in order", async () => {
    const unitList = await lessonsService.listUnits(db, userId);
    expect(unitList).toHaveLength(1);
    expect(unitList[0]?.lessons.map((l) => l.slug)).toEqual(["gruessen", "zu-zweit"]);
    expect(unitList[0]?.completedCount).toBe(0);
  });

  it("marks the lesson that teaches the dual", async () => {
    const unitList = await lessonsService.listUnits(db, userId);
    const byslug = new Map(unitList[0]?.lessons.map((l) => [l.slug, l]));
    expect(byslug.get("zu-zweit")?.teachesDual).toBe(true);
    expect(byslug.get("gruessen")?.teachesDual).toBe(false);
  });

  it("offers the first unfinished lesson as the next one", async () => {
    const next = await lessonsService.getNextLesson(db, userId);
    expect(next?.slug).toBe("gruessen");
  });
});

describe("opening a lesson", () => {
  it("returns its items, intro and grammar notes", async () => {
    const lesson = await lessonsService.getLesson(db, userId, "zu-zweit");
    expect(lesson?.titleDe).toBe("Zu zweit");
    expect(lesson?.items).toHaveLength(1);
    expect(lesson?.items[0]?.slovene).toBe("Se vidiva!");
    expect(lesson?.grammarNotes[0]?.slug).toBe("dvojina-grundlagen");
    expect(lesson?.items[0]?.practice?.answer).toBe("vidiva");
  });

  /** Ordered but never gated: skipping earns a warning, not a locked door. */
  it("reports earlier unfinished lessons without blocking the later one", async () => {
    const lesson = await lessonsService.getLesson(db, userId, "zu-zweit");
    expect(lesson).not.toBeNull();
    expect(lesson?.skippedLessons.map((l) => l.slug)).toEqual(["gruessen"]);
  });

  it("has nothing to warn about for the first lesson", async () => {
    const lesson = await lessonsService.getLesson(db, userId, "gruessen");
    expect(lesson?.skippedLessons).toEqual([]);
  });

  it("remembers where she stopped", async () => {
    const lesson = await lessonsService.getLesson(db, userId, "gruessen");
    await lessonsService.setLessonCursor(db, userId, lesson!.id, 2);
    const resumed = await lessonsService.getLesson(db, userId, "gruessen");
    expect(resumed?.cursor).toBe(2);
    expect(resumed?.status).toBe("in_progress");
  });
});

describe("finishing a lesson", () => {
  it("creates the cards and marks the lesson done", async () => {
    const result = await lessonsService.completeLesson(db, userId, lessonOneId);
    expect(result.cardsCreated).toBeGreaterThan(0);

    const cards = await db
      .select()
      .from(schema.cards)
      .where(drizzle.eq(schema.cards.phraseId, phraseIds[0] as string));
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.introducedByLessonId === lessonOneId)).toBe(true);

    const lesson = await lessonsService.getLesson(db, userId, "gruessen");
    expect(lesson?.status).toBe("completed");
  });

  it("does not double her workload when a lesson is replayed", async () => {
    const before = await db.select().from(schema.cards);
    const again = await lessonsService.completeLesson(db, userId, lessonOneId);
    const after = await db.select().from(schema.cards);

    expect(again.cardsCreated).toBe(0);
    expect(after.length).toBe(before.length);
  });

  it("creates cloze cards for the phrases that carry them", async () => {
    await lessonsService.completeLesson(db, userId, lessonTwoId);
    const cloze = await db
      .select()
      .from(schema.cards)
      .where(drizzle.eq(schema.cards.exerciseType, "cloze"));
    expect(cloze).toHaveLength(1);
  });

  it("moves the next lesson along once one is finished", async () => {
    const next = await lessonsService.getNextLesson(db, userId);
    // Both lessons are now complete.
    expect(next).toBeNull();
  });
});

describe("what she can say", () => {
  it("stays empty until a phrase is genuinely retained", async () => {
    const capabilities = await progressService.getCapabilities(db, userId);
    expect(capabilities).toEqual([]);

    const summary = await progressService.getProgressSummary(db, userId);
    expect(summary.canSay).toBe(0);
    expect(summary.lessonsCompleted).toBe(2);
  });

  it("counts a phrase once its production card holds a week of stability", async () => {
    await db
      .update(schema.cards)
      .set({ state: "review", stability: 9, lastReview: new Date("2026-03-01T10:00:00Z") })
      .where(
        drizzle.and(
          drizzle.eq(schema.cards.phraseId, phraseIds[0] as string),
          drizzle.eq(schema.cards.exerciseType, "production"),
        ),
      );

    const capabilities = await progressService.getCapabilities(db, userId);
    expect(capabilities.map((c) => c.slovene)).toEqual(["Dober dan!"]);
    expect(capabilities[0]?.german).toBe("Guten Tag!");
    expect(capabilities[0]?.contextNote).toBe("Die sichere Wahl.");
  });

  /** Seen once is not the same as able to say it. */
  it("does not count a card that is merely started", async () => {
    await db
      .update(schema.cards)
      .set({ state: "learning", stability: 2, lastReview: new Date() })
      .where(
        drizzle.and(
          drizzle.eq(schema.cards.phraseId, phraseIds[1] as string),
          drizzle.eq(schema.cards.exerciseType, "production"),
        ),
      );

    const capabilities = await progressService.getCapabilities(db, userId);
    expect(capabilities.map((c) => c.slovene)).not.toContain("Se vidiva!");
  });

  it("counts each phrase once, however many of its cards qualify", async () => {
    await db
      .update(schema.cards)
      .set({ state: "review", stability: 20, lastReview: new Date() })
      .where(drizzle.eq(schema.cards.phraseId, phraseIds[0] as string));

    const capabilities = await progressService.getCapabilities(db, userId);
    expect(capabilities.filter((c) => c.slovene === "Dober dan!")).toHaveLength(1);

    const summary = await progressService.getProgressSummary(db, userId);
    expect(summary.canSay).toBe(1);
  });

  it("notices which mastered phrases use the dual", async () => {
    await db
      .update(schema.cards)
      .set({ state: "review", stability: 30, lastReview: new Date() })
      .where(
        drizzle.and(
          drizzle.eq(schema.cards.phraseId, phraseIds[1] as string),
          drizzle.eq(schema.cards.exerciseType, "production"),
        ),
      );

    const capabilities = await progressService.getCapabilities(db, userId);
    expect(capabilities.find((c) => c.slovene === "Se vidiva!")?.isDual).toBe(true);

    const summary = await progressService.getProgressSummary(db, userId);
    expect(summary.canSay).toBe(2);
    expect(summary.dualMastered).toBe(1);
  });

  it("lists the newest first, so returning shows growth", async () => {
    const capabilities = await progressService.getCapabilities(db, userId);
    for (let i = 1; i < capabilities.length; i += 1) {
      expect((capabilities[i - 1] as { reachedAt: Date }).reachedAt.getTime()).toBeGreaterThanOrEqual(
        (capabilities[i] as { reachedAt: Date }).reachedAt.getTime(),
      );
    }
  });
});

describe("course order across units", () => {
  /**
   * Regression: lesson positions restart inside each unit. Comparing them on
   * their own made the third lesson of unit two look like a skip past every
   * lesson numbered one or two in the entire course.
   */
  it("counts skipped lessons by course order, not by lesson number", async () => {
    const [other] = await db
      .insert(schema.users)
      .values({ email: "order@test.local", displayName: "Zweite", role: "learner" })
      .returning({ id: schema.users.id });

    const [secondUnit] = await db
      .insert(schema.units)
      .values({ slug: "familie", titleDe: "Familie", position: 2 })
      .returning({ id: schema.units.id });

    await db.insert(schema.lessons).values({
      unitId: secondUnit!.id,
      slug: "wer-ist-wer",
      titleDe: "Wer ist wer",
      // Position 1 within its unit, but third in the course.
      position: 1,
      status: "active",
    });

    const lesson = await lessonsService.getLesson(db, other!.id, "wer-ist-wer");

    // The two lessons of unit one, and nothing else.
    expect(lesson?.skippedLessons.map((l) => l.slug)).toEqual(["gruessen", "zu-zweit"]);
  });

  it("still reports nothing skipped for the very first lesson of the course", async () => {
    const [fresh] = await db
      .insert(schema.users)
      .values({ email: "first@test.local", displayName: "Dritte", role: "learner" })
      .returning({ id: schema.users.id });

    const lesson = await lessonsService.getLesson(db, fresh!.id, "gruessen");
    expect(lesson?.skippedLessons).toEqual([]);
  });
});
