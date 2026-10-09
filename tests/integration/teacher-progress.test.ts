import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./helpers/database";

/**
 * The teacher's live view of the learner: current lesson, activity recency
 * and the backlog size she never sees on her own screens.
 */
let database: TestDatabase;
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let teacherProgress: typeof import("@/lib/teacher/progress");

let learnerId: string;
let lessonOneId: string;
let lessonTwoId: string;
let phraseIds: string[] = [];

const NOW = new Date("2026-09-20T12:00:00Z");

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  process.env.SESSION_SECRET = "integration-test-secret-that-is-long-enough";
  process.env.MEDIA_ROOT = await mkdtemp(path.join(tmpdir(), "slo-teacher-progress-"));

  db = (await import("@/db/client")).db;
  schema = await import("@/db/schema");
  teacherProgress = await import("@/lib/teacher/progress");

  const users = await db
    .insert(schema.users)
    .values([
      { email: "lernende@test.local", displayName: "Ana", role: "learner" },
      { email: "lehrer@test.local", displayName: "Fabian", role: "teacher" },
    ])
    .returning({ id: schema.users.id, role: schema.users.role });
  learnerId = users.find((u) => u.role === "learner")!.id;
  await db.insert(schema.userSettings).values({ userId: learnerId });

  const [unit] = await db
    .insert(schema.units)
    .values({ slug: "erste-begegnung", titleDe: "Erste Begegnung", position: 1 })
    .returning({ id: schema.units.id });

  const inserted = await db
    .insert(schema.phrases)
    .values([
      {
        slovene: "Dober dan!",
        sloveneNormalized: "dober dan!",
        german: "Guten Tag!",
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
});

afterAll(async () => {
  await database?.stop();
});

describe("finding the learner", () => {
  it("returns the single learner account", async () => {
    const learner = await teacherProgress.findLearner(db);
    expect(learner?.id).toBe(learnerId);
    expect(learner?.displayName).toBe("Ana");
  });
});

describe("her live progress", () => {
  it("has no session and no completed lesson yet", async () => {
    const progress = await teacherProgress.getLearnerProgress(db, NOW);
    expect(progress?.learnerName).toBe("Ana");
    expect(progress?.summary.lessonsCompleted).toBe(0);
    expect(progress?.totalLessons).toBe(2);
    expect(progress?.currentLesson?.slug).toBe("gruessen");
    expect(progress?.lastActiveAt).toBeNull();
    expect(progress?.daysSinceLastActive).toBeNull();
    expect(progress?.hasOpenSession).toBe(false);
    expect(progress?.cardsOverdue).toBe(0);
  });

  it("moves the current lesson along once the first is completed", async () => {
    await db
      .insert(schema.lessonProgress)
      .values({ userId: learnerId, lessonId: lessonOneId, cursor: 0, completedAt: NOW });

    const progress = await teacherProgress.getLearnerProgress(db, NOW);
    expect(progress?.summary.lessonsCompleted).toBe(1);
    expect(progress?.currentLesson?.slug).toBe("zu-zweit");
  });

  it("reports how long ago she was last active, and an open session", async () => {
    await db.insert(schema.studySessions).values({
      userId: learnerId,
      kind: "review",
      status: "active",
      startedAt: new Date("2026-09-18T09:00:00Z"),
      lastActiveAt: new Date("2026-09-18T09:00:00Z"),
    });

    const progress = await teacherProgress.getLearnerProgress(db, NOW);
    expect(progress?.daysSinceLastActive).toBe(2);
    expect(progress?.hasOpenSession).toBe(true);
  });

  it("counts what is overdue right now, ignoring suspended and future cards", async () => {
    await db.insert(schema.cards).values([
      {
        userId: learnerId,
        phraseId: phraseIds[0] as string,
        exerciseType: "recognition",
        due: new Date("2026-09-19T00:00:00Z"),
        suspended: false,
      },
      {
        userId: learnerId,
        phraseId: phraseIds[0] as string,
        exerciseType: "production",
        due: new Date("2026-09-19T00:00:00Z"),
        suspended: false,
      },
      {
        userId: learnerId,
        phraseId: phraseIds[0] as string,
        exerciseType: "listening",
        due: new Date("2026-09-25T00:00:00Z"),
        suspended: false,
      },
      {
        userId: learnerId,
        phraseId: phraseIds[0] as string,
        exerciseType: "speaking",
        due: new Date("2026-09-19T00:00:00Z"),
        suspended: true,
      },
    ]);

    const progress = await teacherProgress.getLearnerProgress(db, NOW);
    expect(progress?.cardsOverdue).toBe(2);
  });
});
