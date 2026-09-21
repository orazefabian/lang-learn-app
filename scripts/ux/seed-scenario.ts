import { and, eq, inArray, sql } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { db } from "@/db/client";
import {
  cards,
  generationItems,
  generationRuns,
  lessonItems,
  lessons,
  lessonProgress,
  notifications,
  phrases,
  questions,
  reviewLogs,
  speechAttempts,
  studySessions,
  units,
  users,
} from "@/db/schema";
import { createCardsForLesson } from "@/lib/srs/cards";

/**
 * App states worth looking at.
 *
 * A screenshot of an empty account answers nothing. Every principle in the
 * brief is about a *situation* — coming back after two weeks, quitting
 * mid-session on a phone, a backlog that must never be dumped — and none of
 * those situations exist in a freshly seeded database. This script puts the
 * app into each of them on demand, so an audit looks at the screens people
 * actually meet.
 *
 *   pnpm ux:seed returning
 *
 * Every scenario is built from the real curriculum (`pnpm seed:content`), not
 * from a handful of fixture rows: thirty-nine lessons in a list is a layout
 * problem, one lesson is not.
 */

const SCENARIOS = {
  fresh: "Day one. Nothing done, nothing due but the first lesson's new cards.",
  steady: "A few weeks in. Lessons finished, a normal number due, the phrasebook filling up.",
  returning: "Back after 24 days away, with a large overdue backlog. Principle 3.",
  "mid-session": "A review session left half-finished on a phone. Principle 5.",
  "teacher-busy": "Steady learner, plus a teacher inbox and draft queue with work in it.",
} as const;

type Scenario = keyof typeof SCENARIOS;

/**
 * Accounts this script is allowed to touch. The guard below refuses to run if
 * the database contains any other user, which is what makes it structurally
 * incapable of rewriting the real deployment's history — the real accounts
 * have real email addresses and would trip it immediately.
 */
const LEARNER_EMAIL = process.env.UX_LEARNER_EMAIL ?? "lernende@ux.local";
const TEACHER_EMAIL = process.env.UX_TEACHER_EMAIL ?? "lehrer@ux.local";
const LEARNER_PASSWORD = process.env.UX_LEARNER_PASSWORD ?? "ux-harness-learner";
const TEACHER_PASSWORD = process.env.UX_TEACHER_PASSWORD ?? "ux-harness-teacher";

const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * DAY);
const daysAhead = (days: number) => new Date(now + days * DAY);

/** Deterministic jitter, so two runs of the same scenario look the same. */
function wobble(seed: number, spread: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * spread;
}

const scenario = (process.argv[2] ?? "steady") as Scenario;
if (!(scenario in SCENARIOS)) {
  console.error(`unknown scenario: ${scenario}`);
  console.error("\navailable:");
  for (const [name, description] of Object.entries(SCENARIOS)) {
    console.error(`  ${name.padEnd(14)} ${description}`);
  }
  process.exit(1);
}

/* ------------------------------------------------------------------ guard */

const existing = await db.select({ email: users.email }).from(users);
const strangers = existing.filter(
  (user) => user.email !== LEARNER_EMAIL && user.email !== TEACHER_EMAIL,
);
if (strangers.length) {
  console.error(
    "refusing to seed: this database has accounts that are not the harness accounts",
  );
  console.error(`  found: ${strangers.map((s) => s.email).join(", ")}`);
  console.error("  the UX harness only ever runs against a throwaway database.");
  process.exit(1);
}

const lessonCount = (await db.select({ value: sql<number>`count(*)::int` }).from(lessons))[0]?.value ?? 0;
if (lessonCount === 0) {
  console.error("refusing to seed: no lessons in this database — run `pnpm seed:content --activate` first");
  process.exit(1);
}

/* --------------------------------------------------------------- accounts */

async function ensureAccount(email: string, password: string, role: "learner" | "teacher", displayName: string) {
  const passwordHash = await hash(password, ARGON2);
  const [user] = await db
    .insert(users)
    .values({ email, displayName, role, passwordHash })
    .onConflictDoUpdate({ target: users.email, set: { passwordHash, displayName, role } })
    .returning({ id: users.id });
  return user!.id;
}

const learnerId = await ensureAccount(LEARNER_EMAIL, LEARNER_PASSWORD, "learner", "Ana");
const teacherId = await ensureAccount(TEACHER_EMAIL, TEACHER_PASSWORD, "teacher", "Fabian");

/* ------------------------------------------------------------------ reset */

/*
 * Everything derived from use, cleared before each scenario. Content is left
 * alone — it is expensive to import and identical for every scenario.
 */
const bothUsers = [learnerId, teacherId];
await db.delete(speechAttempts).where(inArray(speechAttempts.userId, bothUsers));
await db.delete(reviewLogs).where(inArray(reviewLogs.userId, bothUsers));
await db.delete(studySessions).where(inArray(studySessions.userId, bothUsers));
await db.delete(lessonProgress).where(inArray(lessonProgress.userId, bothUsers));
await db.delete(questions).where(inArray(questions.askedBy, bothUsers));
await db.delete(notifications).where(inArray(notifications.userId, bothUsers));
await db.delete(cards).where(inArray(cards.userId, bothUsers));
await db.delete(generationItems);
await db.delete(generationRuns);

/* ------------------------------------------------------- curriculum shape */

const curriculum = await db
  .select({ id: lessons.id, slug: lessons.slug, title: lessons.titleDe, position: lessons.position })
  .from(lessons)
  .innerJoin(units, eq(units.id, lessons.unitId))
  .where(eq(lessons.status, "active"))
  .orderBy(units.position, lessons.position);

/** How much of the track each scenario has been through. */
const SHAPE: Record<Scenario, { completed: number; inProgress: boolean }> = {
  fresh: { completed: 0, inProgress: false },
  steady: { completed: 6, inProgress: true },
  returning: { completed: 12, inProgress: false },
  "mid-session": { completed: 6, inProgress: true },
  "teacher-busy": { completed: 6, inProgress: true },
};

const shape = SHAPE[scenario];
const touched = curriculum.slice(0, shape.completed + (shape.inProgress ? 1 : 0));
// Day one still needs something to do, so the first lesson's cards exist even
// though nothing has been studied yet.
const lessonsToCard = touched.length ? touched : curriculum.slice(0, 1);

for (const lesson of lessonsToCard) {
  await createCardsForLesson(db, learnerId, lesson.id);
}

const completedLessons = curriculum.slice(0, shape.completed);
for (const [index, lesson] of completedLessons.entries()) {
  // Spread the history out so the lesson list does not look finished in one
  // sitting, which is not how this app is used.
  const finishedDaysAgo = (completedLessons.length - index) * 2 + (scenario === "returning" ? 24 : 2);
  await db.insert(lessonProgress).values({
    userId: learnerId,
    lessonId: lesson.id,
    cursor: 0,
    startedAt: daysAgo(finishedDaysAgo + 1),
    completedAt: daysAgo(finishedDaysAgo),
  });
}

if (shape.inProgress && curriculum[shape.completed]) {
  const current = curriculum[shape.completed]!;
  const [itemCount] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(lessonItems)
    .where(eq(lessonItems.lessonId, current.id));
  await db.insert(lessonProgress).values({
    userId: learnerId,
    lessonId: current.id,
    // Stopped partway, which is the normal way a lesson ends on a phone.
    cursor: Math.max(1, Math.floor((itemCount?.value ?? 4) / 2)),
    startedAt: daysAgo(1),
    completedAt: null,
  });
}

/* ------------------------------------------------------------ card ageing */

const learnerCards = await db
  .select({ id: cards.id, exerciseType: cards.exerciseType, phraseId: cards.phraseId })
  .from(cards)
  .where(eq(cards.userId, learnerId))
  .orderBy(cards.createdAt, cards.id);

type Tier = "mastered" | "known" | "due" | "learning" | "new";

/**
 * Which tier each card lands in.
 *
 * The mix is what makes a screen look lived-in: a deck where every card is in
 * the same state renders a screen that never occurs in practice.
 */
function tierFor(index: number, total: number): Tier {
  const position = index / Math.max(total, 1);
  if (scenario === "fresh") return "new";

  if (scenario === "returning") {
    // Everything studied before the absence is now long overdue. That is the
    // whole point of this scenario.
    if (position < 0.75) return "due";
    if (position < 0.85) return "mastered";
    return "new";
  }

  // Deliberately under the default review cap of 20. `steady` should show what
  // an ordinary day looks like when nothing is being held back, so that the
  // capped presentation in `returning` is recognisable as a different screen
  // rather than the only one the harness ever sees.
  if (position < 0.3) return "mastered";
  if (position < 0.5) return "known";
  if (position < 0.56) return "due";
  if (position < 0.62) return "learning";
  return "new";
}

const byTier = new Map<Tier, string[]>();
const reviewedCards: { id: string; tier: Tier; index: number }[] = [];

learnerCards.forEach((card, index) => {
  const tier = tierFor(index, learnerCards.length);
  byTier.set(tier, [...(byTier.get(tier) ?? []), card.id]);
  if (tier !== "new") reviewedCards.push({ id: card.id, tier, index });
});

/**
 * Stability is what the progress view reads: a phrase counts as "can say" only
 * once a production or speaking card is in review with a week of stability
 * behind it. So these numbers are not decoration — they decide whether the
 * phrasebook has anything in it.
 */
const TIERS: Record<Exclude<Tier, "new">, { stability: [number, number]; lastReview: [number, number]; dueOffset: [number, number]; reps: number; state: "review" | "learning" }> = {
  mastered: { stability: [14, 45], lastReview: [6, 24], dueOffset: [4, 30], reps: 7, state: "review" },
  known: { stability: [8, 14], lastReview: [4, 12], dueOffset: [1, 6], reps: 4, state: "review" },
  due: { stability: [3, 11], lastReview: [8, 30], dueOffset: [-26, -1], reps: 3, state: "review" },
  learning: { stability: [0.5, 2.5], lastReview: [0, 2], dueOffset: [-1, 0], reps: 1, state: "learning" },
};

let aged = 0;
for (const { id, tier, index } of reviewedCards) {
  const spec = TIERS[tier as Exclude<Tier, "new">];
  const stability = spec.stability[0] + wobble(index + 1, spec.stability[1] - spec.stability[0]);
  const lastReview = daysAgo(spec.lastReview[0] + wobble(index + 7, spec.lastReview[1] - spec.lastReview[0]));
  const dueDays = spec.dueOffset[0] + wobble(index + 13, spec.dueOffset[1] - spec.dueOffset[0]);

  await db
    .update(cards)
    .set({
      state: spec.state,
      stability,
      difficulty: 4.5 + wobble(index + 3, 3),
      scheduledDays: Math.max(1, Math.round(stability)),
      elapsedDays: Math.max(0, Math.round(stability / 2)),
      reps: spec.reps,
      lapses: tier === "due" ? 1 : 0,
      lastReview,
      due: dueDays >= 0 ? daysAhead(dueDays) : daysAgo(-dueDays),
      introducedAt: lastReview,
    })
    .where(eq(cards.id, id));
  aged += 1;
}

/* ------------------------------------------------------------ review logs */

/*
 * One log per studied card. The digest and the "has she started" empty-state
 * check both read this table, and a deck with history but no logs is a state
 * the app cannot reach on its own.
 */
if (reviewedCards.length) {
  const rows = reviewedCards.map(({ id, tier, index }) => {
    const spec = TIERS[tier as Exclude<Tier, "new">];
    const reviewedAt = daysAgo(spec.lastReview[0] + wobble(index + 7, spec.lastReview[1] - spec.lastReview[0]));
    const stability = spec.stability[0] + wobble(index + 1, spec.stability[1] - spec.stability[0]);
    return {
      cardId: id,
      userId: learnerId,
      rating: (tier === "due" ? "hard" : tier === "learning" ? "again" : "good") as "again" | "hard" | "good",
      state: spec.state,
      due: daysAhead(Math.round(stability)),
      stability,
      difficulty: 4.5 + wobble(index + 3, 3),
      elapsedDays: Math.round(stability / 2),
      lastElapsedDays: Math.round(stability / 3),
      scheduledDays: Math.round(stability),
      reviewedAt,
      durationMs: 2200 + Math.round(wobble(index + 17, 6000)),
    };
  });

  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(reviewLogs).values(rows.slice(i, i + 200));
  }
}

/* -------------------------------------------------------- scenario extras */

const learnerPhrases = await db
  .select({ id: phrases.id, slovene: phrases.slovene, german: phrases.german })
  .from(phrases)
  .where(eq(phrases.status, "active"))
  .orderBy(phrases.slovene)
  .limit(12);

if (scenario === "mid-session") {
  /*
   * A session abandoned partway through. The queue lives server-side precisely
   * so this state survives the app being closed, and it is the only way to see
   * what resuming actually looks like.
   */
  const queueCards = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.userId, learnerId), eq(cards.state, "review")))
    .limit(20);

  await db.insert(studySessions).values({
    userId: learnerId,
    kind: "review",
    status: "active",
    queue: queueCards.map((card) => card.id),
    cursor: 7,
    answeredCount: 7,
    startedAt: daysAgo(2),
    lastActiveAt: daysAgo(2),
  });
}

if (scenario === "steady" || scenario === "mid-session" || scenario === "teacher-busy") {
  // One answered question and one still open: the card-level answer path only
  // renders when an answer actually exists.
  const [first, second] = learnerPhrases;
  if (first) {
    await db.insert(questions).values({
      askedBy: learnerId,
      phraseId: first.id,
      body: "Warum ist das hier anders als in der Lektion?",
      status: "answered",
      answerText:
        "Gute Frage — das ist der Dual. Bei zwei Personen bekommt das Verb eine eigene Endung, nicht die Pluralendung.",
      answeredBy: teacherId,
      answeredAt: daysAgo(3),
      createdAt: daysAgo(4),
    });
  }
  if (second) {
    await db.insert(questions).values({
      askedBy: learnerId,
      phraseId: second.id,
      body: "Sagt man das auch so zu Oma?",
      status: "open",
      createdAt: daysAgo(1),
    });
  }
}

if (scenario === "teacher-busy") {
  for (const [index, phrase] of learnerPhrases.slice(2, 6).entries()) {
    await db.insert(questions).values({
      askedBy: learnerId,
      phraseId: phrase.id,
      body: index % 2 === 0 ? "Wann benutzt man das?" : null,
      status: "open",
      createdAt: daysAgo(index + 1),
    });
  }

  const [run] = await db
    .insert(generationRuns)
    .values({
      requestedBy: teacherId,
      topic: "Beim Bäcker bestellen",
      instructions: "Alltagssätze, die sie bei Oma im Dorf wirklich braucht.",
      kind: "mixed",
      requestedCount: 8,
      model: "claude-opus-5",
      status: "succeeded",
      proposedCount: 8,
      draftedCount: 6,
      duplicateCount: 2,
      modelNotes: "Zwei Vorschläge überschneiden sich mit vorhandenen Phrasen.",
      createdAt: daysAgo(2),
      completedAt: daysAgo(2),
    })
    .returning({ id: generationRuns.id });

  const drafts = [
    { slovene: "Prosim en kruh.", german: "Einen Brot, bitte." },
    { slovene: "Koliko stane?", german: "Was kostet das?" },
    { slovene: "Lahko plačam s kartico?", german: "Kann ich mit Karte zahlen?" },
    { slovene: "Imate še kaj svežega?", german: "Haben Sie noch etwas Frisches?" },
  ];

  for (const draft of drafts) {
    await db.insert(generationItems).values({
      runId: run!.id,
      kind: "phrase",
      payload: { slovene: draft.slovene, german: draft.german, register: "standard" },
      decision: "pending",
      createdAt: daysAgo(2),
    });
  }
}

/* ----------------------------------------------------------------- report */

const [dueNow] = await db
  .select({ value: sql<number>`count(*)::int` })
  .from(cards)
  .where(and(eq(cards.userId, learnerId), sql`${cards.due} <= now()`, eq(cards.suspended, false)));

const [canSay] = await db
  .select({ value: sql<number>`count(distinct ${cards.phraseId})::int` })
  .from(cards)
  .where(
    and(
      eq(cards.userId, learnerId),
      inArray(cards.exerciseType, ["production", "speaking"]),
      eq(cards.state, "review"),
      sql`${cards.stability} >= 7`,
    ),
  );

console.log(`scenario:        ${scenario} — ${SCENARIOS[scenario]}`);
console.log(`learner:         ${LEARNER_EMAIL} / ${LEARNER_PASSWORD}`);
console.log(`teacher:         ${TEACHER_EMAIL} / ${TEACHER_PASSWORD}`);
console.log(`lessons touched: ${lessonsToCard.length} of ${curriculum.length} (${shape.completed} completed)`);
console.log(`cards:           ${learnerCards.length} total, ${aged} with history`);
console.log(`due right now:   ${dueNow?.value ?? 0}`);
console.log(`can say:         ${canSay?.value ?? 0} phrases`);
process.exit(0);
