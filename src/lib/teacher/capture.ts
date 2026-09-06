import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { lexemes, phrases, users } from "@/db/schema";
import { normalizeSlovene } from "@/lib/seed/schemas";
import { createCardsForItems } from "@/lib/srs/cards";

/**
 * Quick capture.
 *
 * The shape of this is set by where it gets used: standing at a family dinner,
 * on a phone, one-handed, with ten seconds before the moment passes. The only
 * required field is the Slovene. Everything else can be filled in later from
 * the content browser.
 *
 * Captured items go into the normal review pool with no priority boost and no
 * deadline. They are not urgent; they are simply part of what she is learning.
 */

export type CaptureInput = {
  slovene: string;
  german?: string;
  /** "was Oma sagt, wenn sie dir Essen anbietet" — the thing that makes it stick. */
  contextNote?: string;
  tags?: string[];
  register?: "standard" | "colloquial" | "regional" | "formal";
  regionLabel?: string;
  /** A single word is stored as a lexeme; anything longer as a phrase. */
  kind?: "phrase" | "lexeme" | "auto";
};

export type CaptureResult = {
  id: string;
  kind: "phrase" | "lexeme";
  /** True when an item with the same normalised form already existed. */
  duplicate: boolean;
  cardsCreated: number;
};

function looksLikeSingleWord(text: string): boolean {
  return text.trim().split(/\s+/).length === 1;
}

/**
 * Creates the item and, if the learner exists, its cards.
 *
 * Teacher-captured content goes live immediately — unlike AI drafts, which
 * wait for approval. The teacher heard it said; that is the review.
 */
export async function captureItem(
  db: Db,
  teacherId: string,
  input: CaptureInput,
): Promise<CaptureResult> {
  const slovene = input.slovene.trim();
  if (!slovene) throw new Error("the Slovene is required");

  const normalized = normalizeSlovene(slovene);
  const kind =
    input.kind && input.kind !== "auto"
      ? input.kind
      : looksLikeSingleWord(slovene)
        ? "lexeme"
        : "phrase";

  const german = input.german?.trim() ?? "";
  const tags = [...new Set([...(input.tags ?? []), "quick-capture"])];

  let id: string;
  let duplicate = false;

  if (kind === "phrase") {
    const [existing] = await db
      .select({ id: phrases.id })
      .from(phrases)
      .where(eq(phrases.sloveneNormalized, normalized))
      .limit(1);

    if (existing) {
      duplicate = true;
      id = existing.id;
      // Fill in what the capture adds without overwriting what is there.
      await db
        .update(phrases)
        .set({
          ...(german ? { german } : {}),
          ...(input.contextNote ? { contextNote: input.contextNote } : {}),
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(phrases.id, existing.id));
    } else {
      const [created] = await db
        .insert(phrases)
        .values({
          slovene,
          sloveneNormalized: normalized,
          german,
          contextNote: input.contextNote ?? null,
          register: input.register ?? "standard",
          regionLabel: input.regionLabel ?? null,
          tags,
          source: "teacher",
          createdBy: teacherId,
          status: "active",
        })
        .returning({ id: phrases.id });
      if (!created) throw new Error("could not save the phrase");
      id = created.id;
    }
  } else {
    const [existing] = await db
      .select({ id: lexemes.id })
      .from(lexemes)
      .where(eq(lexemes.sloveneNormalized, normalized))
      .limit(1);

    if (existing) {
      duplicate = true;
      id = existing.id;
      await db
        .update(lexemes)
        .set({
          ...(german ? { german: german.split(",").map((p) => p.trim()).filter(Boolean) } : {}),
          ...(input.contextNote ? { notes: input.contextNote } : {}),
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(lexemes.id, existing.id));
    } else {
      const [created] = await db
        .insert(lexemes)
        .values({
          slovene,
          sloveneNormalized: normalized,
          german: german ? german.split(",").map((p) => p.trim()).filter(Boolean) : [],
          partOfSpeech: "other",
          register: input.register ?? "standard",
          regionLabel: input.regionLabel ?? null,
          notes: input.contextNote ?? null,
          tags,
          source: "teacher",
          createdBy: teacherId,
          status: "active",
        })
        .returning({ id: lexemes.id });
      if (!created) throw new Error("could not save the word");
      id = created.id;
    }
  }

  // Hand it to the learner's deck at the back of the queue, like anything else.
  let cardsCreated = 0;
  const learners = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "learner"));

  for (const learner of learners) {
    const result = await createCardsForItems(db, learner.id, {
      ...(kind === "phrase" ? { phraseIds: [id] } : { lexemeIds: [id] }),
    });
    cardsCreated += result.created;
  }

  return { id, kind, duplicate, cardsCreated };
}

/** The teacher's own recent captures, for the "did that save?" glance. */
export async function recentCaptures(db: Db, teacherId: string, limit = 10) {
  const phraseRows = await db
    .select({
      id: phrases.id,
      slovene: phrases.slovene,
      german: phrases.german,
      contextNote: phrases.contextNote,
      createdAt: phrases.createdAt,
    })
    .from(phrases)
    .where(and(eq(phrases.source, "teacher"), eq(phrases.createdBy, teacherId)))
    .orderBy(phrases.createdAt)
    .limit(limit);

  return phraseRows
    .map((row) => ({ ...row, kind: "phrase" as const }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
