import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./helpers/database";

/**
 * The weekly digest.
 *
 * Two things are being checked: that the numbers describe the week honestly,
 * and that running the job repeatedly cannot produce a second digest or a
 * second email for the same week.
 */
let database: TestDatabase;
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let digest: typeof import("@/lib/digest/service");
let run: typeof import("@/lib/digest/run");
let email: typeof import("@/lib/digest/email");
let drizzle: typeof import("drizzle-orm");

let learnerId: string;
let teacherId: string;
let phraseId: string;
let hardPhraseId: string;
let lexemeId: string;

/** Sunday 2026-09-06 18:00 Berlin is the boundary; the week runs back from it. */
const NOW = new Date("2026-09-09T09:00:00Z");
const PERIOD = {
  start: new Date("2026-08-30T16:00:00Z"),
  end: new Date("2026-09-06T16:00:00Z"),
};
const IN_WEEK = new Date("2026-09-02T19:00:00Z");
const BEFORE_WEEK = new Date("2026-08-20T19:00:00Z");

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.url;
  process.env.SESSION_SECRET = "integration-test-secret-that-is-long-enough";
  process.env.MEDIA_ROOT = await mkdtemp(path.join(tmpdir(), "slo-digest-"));
  process.env.DIGEST_DAY = "sunday";
  process.env.DIGEST_HOUR = "18";
  process.env.DIGEST_TIMEZONE = "Europe/Berlin";

  db = (await import("@/db/client")).db;
  schema = await import("@/db/schema");
  digest = await import("@/lib/digest/service");
  run = await import("@/lib/digest/run");
  email = await import("@/lib/digest/email");
  drizzle = await import("drizzle-orm");

  const users = await db
    .insert(schema.users)
    .values([
      { email: "lernende@test.local", displayName: "Ana", role: "learner" },
      { email: "lehrer@test.local", displayName: "Fabian", role: "teacher" },
    ])
    .returning({ id: schema.users.id, role: schema.users.role });
  learnerId = users.find((u) => u.role === "learner")!.id;
  teacherId = users.find((u) => u.role === "teacher")!.id;
  await db.insert(schema.userSettings).values({ userId: learnerId });

  const inserted = await db
    .insert(schema.phrases)
    .values([
      {
        slovene: "Rada bi kavo.",
        sloveneNormalized: "rada bi kavo.",
        german: "Ich hätte gern einen Kaffee.",
        status: "active",
        source: "seed",
      },
      {
        slovene: "Grem v trgovino.",
        sloveneNormalized: "grem v trgovino.",
        german: "Ich gehe in den Laden.",
        status: "active",
        source: "seed",
      },
    ])
    .returning({ id: schema.phrases.id, slovene: schema.phrases.slovene });
  phraseId = inserted.find((p) => p.slovene === "Rada bi kavo.")!.id;
  hardPhraseId = inserted.find((p) => p.slovene === "Grem v trgovino.")!.id;

  const [lexeme] = await db
    .insert(schema.lexemes)
    .values({
      slovene: "hvaležen",
      sloveneNormalized: "hvalezen",
      german: ["dankbar"],
      partOfSpeech: "adjective",
      status: "active",
      source: "seed",
    })
    .returning({ id: schema.lexemes.id });
  lexemeId = lexeme!.id;
});

afterAll(async () => {
  await database?.stop();
});

async function makeCard(input: {
  phraseId?: string;
  lexemeId?: string;
  exerciseType: "recognition" | "production" | "listening" | "speaking";
  lapses?: number;
  stability?: number;
  reps?: number;
  state?: "new" | "learning" | "review";
}): Promise<string> {
  const [card] = await db
    .insert(schema.cards)
    .values({
      userId: learnerId,
      phraseId: input.phraseId ?? null,
      lexemeId: input.lexemeId ?? null,
      exerciseType: input.exerciseType,
      lapses: input.lapses ?? 0,
      stability: input.stability ?? 1,
      reps: input.reps ?? 0,
      state: input.state ?? "review",
      lastReview: IN_WEEK,
    })
    .returning({ id: schema.cards.id });
  return card!.id;
}

async function logReview(input: {
  cardId: string;
  rating: "again" | "hard" | "good" | "easy";
  state: "new" | "learning" | "review";
  at: Date;
  sessionId?: string;
  durationMs?: number;
}): Promise<void> {
  await db.insert(schema.reviewLogs).values({
    cardId: input.cardId,
    userId: learnerId,
    rating: input.rating,
    state: input.state,
    due: input.at,
    stability: 3,
    difficulty: 5,
    elapsedDays: 1,
    lastElapsedDays: 1,
    scheduledDays: 3,
    reviewedAt: input.at,
    studySessionId: input.sessionId ?? null,
    durationMs: input.durationMs ?? 6_000,
  });
}

describe("the week's numbers", () => {
  let data: import("@/lib/digest/service").DigestData;

  beforeAll(async () => {
    const [session] = await db
      .insert(schema.studySessions)
      .values({
        userId: learnerId,
        kind: "review",
        status: "completed",
        startedAt: IN_WEEK,
        lastActiveAt: IN_WEEK,
      })
      .returning({ id: schema.studySessions.id });

    const easy = await makeCard({ phraseId, exerciseType: "recognition", reps: 6, stability: 20 });
    const hard = await makeCard({
      phraseId: hardPhraseId,
      exerciseType: "speaking",
      reps: 9,
      stability: 1.2,
      lapses: 5,
    });
    const word = await makeCard({
      lexemeId,
      exerciseType: "production",
      reps: 4,
      stability: 2,
      lapses: 2,
    });
    // A mastered speaking card, which is what "can say" counts.
    await makeCard({ phraseId, exerciseType: "speaking", reps: 8, stability: 30 });

    await logReview({ cardId: easy, rating: "good", state: "review", at: IN_WEEK, sessionId: session!.id });
    await logReview({ cardId: hard, rating: "again", state: "review", at: IN_WEEK, sessionId: session!.id });
    await logReview({ cardId: word, rating: "good", state: "review", at: IN_WEEK, sessionId: session!.id });
    // A learning-step repeat: not a retention data point.
    await logReview({ cardId: hard, rating: "good", state: "learning", at: IN_WEEK, sessionId: session!.id });
    // A brand new card met for the first time.
    await logReview({ cardId: word, rating: "good", state: "new", at: IN_WEEK, sessionId: session!.id });
    // Last week's work must not leak into this week's numbers.
    await logReview({ cardId: easy, rating: "good", state: "review", at: BEFORE_WEEK });

    data = await digest.buildDigest(db, {
      subjectUserId: learnerId,
      period: PERIOD,
      now: NOW,
    });
  });

  it("counts only what happened inside the week", () => {
    expect(data.reviewed.total).toBe(5);
    expect(data.reviewed.sessions).toBe(1);
    expect(data.reviewed.activeDays).toBe(1);
  });

  /** Learning repeats would flatter the number, so they are left out. */
  it("measures retention on mature cards only", () => {
    expect(data.retention.mature).toBe(3);
    expect(data.retention.recalled).toBe(2);
    expect(data.retention.rate).toBeCloseTo(2 / 3, 5);
  });

  it("counts new material by cards met for the first time", () => {
    expect(data.learned.newCardsStarted).toBe(1);
  });

  it("counts what she can say, not how many cards exist", () => {
    expect(data.learned.canSayTotal).toBe(1);
  });

  it("puts the most-forgotten item first", () => {
    expect(data.struggling[0]?.slovene).toBe("Grem v trgovino.");
    expect(data.struggling[0]?.lapses).toBe(5);
    expect(data.struggling[0]?.hasHumanAudio).toBe(false);
  });

  /** One line per item, however many exercises it produced. */
  it("lists an item once even when several of its cards are hard", async () => {
    const second = await makeCard({
      phraseId: hardPhraseId,
      exerciseType: "listening",
      reps: 7,
      stability: 1,
      lapses: 4,
    });
    await logReview({ cardId: second, rating: "again", state: "review", at: IN_WEEK });

    const rebuilt = await digest.buildDigest(db, {
      subjectUserId: learnerId,
      period: PERIOD,
      now: NOW,
    });
    const appearances = rebuilt.struggling.filter((item) => item.itemId === hardPhraseId);
    expect(appearances).toHaveLength(1);
  });

  it("reports how long ago the last session was, without comment", () => {
    expect(data.lastSessionAt).toBe(IN_WEEK.toISOString());
    expect(data.daysSinceLastSession).toBe(6);
  });

  /** An empty week is not a zero-percent week. */
  it("has no retention rate when nothing mature was reviewed", async () => {
    const empty = await digest.buildDigest(db, {
      subjectUserId: teacherId,
      period: PERIOD,
      now: NOW,
    });
    expect(empty.retention.rate).toBeNull();
    expect(empty.reviewed.total).toBe(0);
    expect(empty.daysSinceLastSession).toBeNull();
  });
});

describe("speech and questions", () => {
  it("shows the lowest-scoring attempts and the open questions", async () => {
    const [existing] = await db
      .select({ id: schema.cards.id })
      .from(schema.cards)
      .where(
        drizzle.and(
          drizzle.eq(schema.cards.phraseId, phraseId),
          drizzle.eq(schema.cards.exerciseType, "speaking"),
        ),
      )
      .limit(1);
    const card = existing!.id;

    await db.insert(schema.speechAttempts).values([
      {
        userId: learnerId,
        cardId: card,
        targetText: "Rada bi kavo.",
        audioPath: "recordings/a.webm",
        transcript: "rada bi kava",
        charSimilarity: 0.82,
        band: "close",
        status: "scored",
        createdAt: IN_WEEK,
      },
      {
        userId: learnerId,
        cardId: card,
        targetText: "Grem v trgovino.",
        audioPath: "recordings/b.webm",
        transcript: "grem trgovina",
        charSimilarity: 0.55,
        band: "off",
        status: "scored",
        createdAt: IN_WEEK,
      },
      {
        userId: learnerId,
        cardId: card,
        targetText: "Zunaj sem.",
        audioPath: "recordings/c.webm",
        charSimilarity: 0.1,
        status: "failed",
        createdAt: BEFORE_WEEK,
      },
    ]);

    await db.insert(schema.questions).values({
      askedBy: learnerId,
      phraseId,
      body: "Warum kavo?",
      status: "open",
      createdAt: new Date("2026-09-01T10:00:00Z"),
    });

    const data = await digest.buildDigest(db, {
      subjectUserId: learnerId,
      period: PERIOD,
      now: NOW,
    });

    expect(data.speech.attempts).toBe(2);
    expect(data.speech.lowest[0]?.targetText).toBe("Grem v trgovino.");
    expect(data.speech.lowest[0]?.transcript).toBe("grem trgovina");

    expect(data.openQuestions).toHaveLength(1);
    expect(data.openQuestions[0]?.body).toBe("Warum kavo?");
    expect(data.openQuestions[0]?.ageDays).toBe(7);
  });
});

describe("running the job", () => {
  it("writes the week once and emails it once", async () => {
    const sent: { subject: string }[] = [];
    const mailer = {
      send: async (rendered: { subject: string }) => {
        sent.push(rendered);
      },
    };

    const first = await run.runWeeklyDigest(db, { now: NOW, mailer });
    expect(first.produced.filter((entry) => entry.created)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain("Woche");

    const second = await run.runWeeklyDigest(db, { now: NOW, mailer });
    expect(second.produced.every((entry) => !entry.created)).toBe(true);
    // The point of the whole idempotency exercise: no second email.
    expect(sent).toHaveLength(1);

    const rows = await db
      .select()
      .from(schema.digestSnapshots)
      .where(drizzle.eq(schema.digestSnapshots.subjectUserId, learnerId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.emailedAt).not.toBeNull();
  });

  it("rebuilds in place when forced, and still does not resend", async () => {
    const sent: unknown[] = [];
    const mailer = { send: async (rendered: unknown) => void sent.push(rendered) };

    const forced = await run.runWeeklyDigest(db, { now: NOW, force: true, mailer });
    expect(forced.produced[0]?.created).toBe(false);
    expect(sent).toHaveLength(0);

    const rows = await db
      .select()
      .from(schema.digestSnapshots)
      .where(drizzle.eq(schema.digestSnapshots.subjectUserId, learnerId));
    expect(rows).toHaveLength(1);
  });

  it("covers the period the schedule says, not the last seven days", async () => {
    const [snapshot] = await digest.listSnapshots(db, 1);
    expect(snapshot?.periodStart.toISOString()).toBe(PERIOD.start.toISOString());
    expect(snapshot?.periodEnd.toISOString()).toBe(PERIOD.end.toISOString());
    expect(snapshot?.subjectName).toBe("Ana");
  });

  it("sends nothing at all when no mailer is configured", async () => {
    const result = await run.runWeeklyDigest(db, {
      now: new Date("2026-09-16T09:00:00Z"),
      mailer: null,
    });
    expect(result.produced[0]?.created).toBe(true);
    expect(result.produced[0]?.emailed).toBe(false);
  });
});

describe("the email", () => {
  it("reports the week without characterising it", async () => {
    const [snapshot] = await digest.listSnapshots(db, 1);
    const rendered = email.renderDigestEmail({
      subjectName: "Ana",
      data: snapshot!.data,
      appUrl: "https://slo.example",
    });

    expect(rendered.subject).toMatch(/Woche/);
    expect(rendered.text).toContain("Wiederholungen");
    expect(rendered.html).toContain("<p");
    expect(rendered.text).toContain("https://slo.example/teacher/digest");

    // No nagging, in either direction.
    expect(rendered.text).not.toMatch(/nur |leider|Streak|Ziel verfehlt/i);
  });

  it("escapes item text rather than trusting it in the html part", () => {
    const rendered = email.renderDigestEmail({
      subjectName: "Ana",
      data: {
        period: { start: PERIOD.start.toISOString(), end: PERIOD.end.toISOString() },
        reviewed: { total: 1, distinctCards: 1, sessions: 1, minutes: 1, activeDays: 1 },
        retention: { mature: 1, recalled: 1, rate: 1 },
        learned: { newCardsStarted: 0, lessonsCompleted: 0, canSayTotal: 0 },
        struggling: [
          {
            cardId: "c",
            kind: "phrase",
            itemId: "i",
            slovene: "<script>alert(1)</script>",
            german: "böse",
            contextNote: null,
            exerciseType: "speaking",
            lapses: 3,
            stability: 1,
            reps: 4,
            lastReviewAt: null,
            hasHumanAudio: false,
          },
        ],
        speech: { attempts: 0, scored: 0, lowest: [] },
        openQuestions: [],
        lastSessionAt: null,
        daysSinceLastSession: null,
      },
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });
});
