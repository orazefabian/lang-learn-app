import { eq, sql } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { db } from "@/db/client";
import { lessonItems, lessons, phrases, units, users } from "@/db/schema";
import { createCardsForItems } from "@/lib/srs/cards";
import { normalizeSlovene } from "@/lib/seed/schemas";

/**
 * Fixtures for the end-to-end suite.
 *
 * Two accounts with known passwords and one small lesson — enough for every
 * journey the specs walk, and small enough that a run takes seconds.
 *
 *   pnpm e2e:seed
 *
 * Refuses to run against a database that looks real, so it cannot be pointed
 * at the actual deployment by mistake.
 */
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const [existingPhrases] = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(phrases);
const phraseCount = existingPhrases?.count ?? 0;

if (phraseCount > 60) {
  console.error(
    `refusing to seed: this database already has ${phraseCount} phrases and does not look like a test database`,
  );
  process.exit(1);
}

const accounts = [
  {
    role: "learner" as const,
    email: process.env.E2E_LEARNER_EMAIL ?? "lernende@e2e.local",
    password: process.env.E2E_LEARNER_PASSWORD ?? "e2e-learner-password",
    displayName: "Ana",
  },
  {
    role: "teacher" as const,
    email: process.env.E2E_TEACHER_EMAIL ?? "lehrer@e2e.local",
    password: process.env.E2E_TEACHER_PASSWORD ?? "e2e-teacher-password",
    displayName: "Fabian",
  },
];

const ids: Record<string, string> = {};

for (const account of accounts) {
  const passwordHash = await hash(account.password, ARGON2);
  const [user] = await db
    .insert(users)
    .values({
      email: account.email,
      displayName: account.displayName,
      role: account.role,
      passwordHash,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash, displayName: account.displayName, role: account.role },
    })
    .returning({ id: users.id });
  ids[account.role] = user!.id;
  console.log(`${account.role}: ${account.email}`);
}

const PHRASES = [
  { slovene: "Dober dan!", german: "Guten Tag!" },
  { slovene: "Kako si?", german: "Wie geht es dir?" },
  { slovene: "Hvala lepa.", german: "Vielen Dank." },
  { slovene: "Rada bi kavo.", german: "Ich hätte gern einen Kaffee." },
  { slovene: "Se vidiva!", german: "Wir sehen uns!" },
  { slovene: "Lahko noč.", german: "Gute Nacht." },
];

/*
 * Looked up before inserting rather than relying on ON CONFLICT: the index on
 * sloveneNormalized is not unique, so onConflictDoNothing has nothing to
 * conflict with and a second run would quietly double the deck.
 */
const phraseIds: string[] = [];
for (const phrase of PHRASES) {
  const normalized = normalizeSlovene(phrase.slovene);

  const [existing] = await db
    .select({ id: phrases.id })
    .from(phrases)
    .where(eq(phrases.sloveneNormalized, normalized))
    .limit(1);

  if (existing) {
    phraseIds.push(existing.id);
    continue;
  }

  const [created] = await db
    .insert(phrases)
    .values({
      slovene: phrase.slovene,
      sloveneNormalized: normalized,
      german: phrase.german,
      status: "active",
      source: "seed",
    })
    .returning({ id: phrases.id });

  if (created) phraseIds.push(created.id);
}

const [unit] = await db
  .insert(units)
  .values({ slug: "e2e-unit", titleDe: "Test", position: 1 })
  .onConflictDoUpdate({ target: units.slug, set: { titleDe: "Test" } })
  .returning({ id: units.id });

const [lesson] = await db
  .insert(lessons)
  .values({
    unitId: unit!.id,
    slug: "e2e-lesson",
    titleDe: "Grüßen",
    introDe: "Ein paar Wörter zum Anfangen.",
    goalDe: "Jemanden begrüßen.",
    position: 1,
    estimatedMinutes: 3,
    status: "active",
    source: "seed",
  })
  .onConflictDoUpdate({ target: lessons.slug, set: { status: "active", titleDe: "Grüßen" } })
  .returning({ id: lessons.id });

await db.delete(lessonItems).where(eq(lessonItems.lessonId, lesson!.id));
await db.insert(lessonItems).values(
  phraseIds.slice(0, 3).map((phraseId, position) => ({
    lessonId: lesson!.id,
    phraseId,
    position,
  })),
);

// Cards for the learner so /review has something in it from the first run.
const result = await createCardsForItems(db, ids.learner!, { phraseIds });
console.log(`lesson: 3 items · cards: ${result.created} created, ${result.skipped} already there`);
console.log("e2e fixtures ready");
process.exit(0);
