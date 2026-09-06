import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { cards, lexemes, mediaAssets, phrases } from "@/db/schema";
import { normalizeSlovene } from "@/lib/seed/schemas";

/**
 * The content browser: one searchable view over everything in the deck, so the
 * teacher can find a phrase, fix it, and move on.
 */

export type ContentKind = "phrase" | "lexeme";
export type ContentStatus = "draft" | "active" | "archived";

export type ContentRow = {
  id: string;
  kind: ContentKind;
  slovene: string;
  german: string;
  contextNote: string | null;
  status: ContentStatus;
  source: "seed" | "ai" | "teacher";
  register: string;
  tags: string[];
  partOfSpeech: string | null;
  gender: string | null;
  /** How many recordings and generated clips this item has. */
  audioCount: number;
  humanAudioCount: number;
  updatedAt: Date;
};

export type ContentQuery = {
  search?: string;
  kind?: ContentKind | "all";
  status?: ContentStatus | "all";
  source?: "seed" | "ai" | "teacher" | "all";
  /** Only items nobody has recorded yet — the teacher's working list. */
  missingHumanAudio?: boolean;
  limit?: number;
  offset?: number;
};

async function audioCounts(db: Db, ids: { phraseIds: string[]; lexemeIds: string[] }) {
  const counts = new Map<string, { total: number; human: number }>();
  const all = [...ids.phraseIds, ...ids.lexemeIds];
  if (!all.length) return counts;

  const rows = await db
    .select({
      phraseId: mediaAssets.phraseId,
      lexemeId: mediaAssets.lexemeId,
      kind: mediaAssets.kind,
    })
    .from(mediaAssets)
    .where(
      or(
        ids.phraseIds.length ? inArray(mediaAssets.phraseId, ids.phraseIds) : sql`false`,
        ids.lexemeIds.length ? inArray(mediaAssets.lexemeId, ids.lexemeIds) : sql`false`,
      ),
    );

  for (const row of rows) {
    const key = row.phraseId ?? row.lexemeId;
    if (!key) continue;
    const current = counts.get(key) ?? { total: 0, human: 0 };
    current.total += 1;
    if (row.kind === "human_recording") current.human += 1;
    counts.set(key, current);
  }
  return counts;
}

export async function searchContent(db: Db, query: ContentQuery = {}): Promise<ContentRow[]> {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const search = query.search?.trim();
  // Search matches the folded form too, so "zivjo" finds "Živjo".
  const pattern = search ? `%${search}%` : null;
  const normalizedPattern = search ? `%${normalizeSlovene(search)}%` : null;

  const wantPhrases = !query.kind || query.kind === "all" || query.kind === "phrase";
  const wantLexemes = !query.kind || query.kind === "all" || query.kind === "lexeme";

  const rows: ContentRow[] = [];

  if (wantPhrases) {
    const conditions = [];
    if (pattern && normalizedPattern) {
      conditions.push(
        or(
          ilike(phrases.slovene, pattern),
          ilike(phrases.sloveneNormalized, normalizedPattern),
          ilike(phrases.german, pattern),
          ilike(phrases.contextNote, pattern),
        ),
      );
    }
    if (query.status && query.status !== "all") {
      conditions.push(eq(phrases.status, query.status));
    }
    if (query.source && query.source !== "all") {
      conditions.push(eq(phrases.source, query.source));
    }

    const found = await db
      .select()
      .from(phrases)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(phrases.updatedAt))
      .limit(limit)
      .offset(offset);

    rows.push(
      ...found.map(
        (row): ContentRow => ({
          id: row.id,
          kind: "phrase",
          slovene: row.slovene,
          german: row.german,
          contextNote: row.contextNote,
          status: row.status,
          source: row.source,
          register: row.register,
          tags: row.tags,
          partOfSpeech: null,
          gender: null,
          audioCount: 0,
          humanAudioCount: 0,
          updatedAt: row.updatedAt,
        }),
      ),
    );
  }

  if (wantLexemes) {
    const conditions = [];
    if (pattern && normalizedPattern) {
      conditions.push(
        or(
          ilike(lexemes.slovene, pattern),
          ilike(lexemes.sloveneNormalized, normalizedPattern),
          sql`${lexemes.german}::text ilike ${pattern}`,
        ),
      );
    }
    if (query.status && query.status !== "all") {
      conditions.push(eq(lexemes.status, query.status));
    }
    if (query.source && query.source !== "all") {
      conditions.push(eq(lexemes.source, query.source));
    }

    const found = await db
      .select()
      .from(lexemes)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(lexemes.updatedAt))
      .limit(limit)
      .offset(offset);

    rows.push(
      ...found.map(
        (row): ContentRow => ({
          id: row.id,
          kind: "lexeme",
          slovene: row.slovene,
          german: row.german.join(", "),
          contextNote: row.notes,
          status: row.status,
          source: row.source,
          register: row.register,
          tags: row.tags,
          partOfSpeech: row.partOfSpeech,
          gender: row.gender,
          audioCount: 0,
          humanAudioCount: 0,
          updatedAt: row.updatedAt,
        }),
      ),
    );
  }

  const counts = await audioCounts(db, {
    phraseIds: rows.filter((r) => r.kind === "phrase").map((r) => r.id),
    lexemeIds: rows.filter((r) => r.kind === "lexeme").map((r) => r.id),
  });

  for (const row of rows) {
    const count = counts.get(row.id);
    row.audioCount = count?.total ?? 0;
    row.humanAudioCount = count?.human ?? 0;
  }

  const filtered = query.missingHumanAudio
    ? rows.filter((row) => row.humanAudioCount === 0)
    : rows;

  return filtered
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit);
}

export type ContentDetail = ContentRow & {
  notes: string | null;
  regionLabel: string | null;
  difficulty: number;
  aspect: string | null;
  audio: {
    id: string;
    kind: "tts" | "human_recording";
    speakerLabel: string | null;
    path: string;
    fallbackPath: string | null;
    createdAt: Date;
  }[];
  /** Whether the learner already has cards for this item. */
  inDeck: boolean;
};

export async function getContentItem(
  db: Db,
  kind: ContentKind,
  id: string,
): Promise<ContentDetail | null> {
  const base =
    kind === "phrase"
      ? await db.select().from(phrases).where(eq(phrases.id, id)).limit(1)
      : await db.select().from(lexemes).where(eq(lexemes.id, id)).limit(1);

  const row = base[0];
  if (!row) return null;

  const audio = await db
    .select()
    .from(mediaAssets)
    .where(
      kind === "phrase" ? eq(mediaAssets.phraseId, id) : eq(mediaAssets.lexemeId, id),
    )
    .orderBy(desc(mediaAssets.priority), desc(mediaAssets.createdAt));

  const [cardRow] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(kind === "phrase" ? eq(cards.phraseId, id) : eq(cards.lexemeId, id))
    .limit(1);

  const isPhrase = kind === "phrase";
  const phraseRow = isPhrase ? (row as typeof phrases.$inferSelect) : null;
  const lexemeRow = isPhrase ? null : (row as typeof lexemes.$inferSelect);

  return {
    id: row.id,
    kind,
    slovene: row.slovene,
    german: phraseRow ? phraseRow.german : (lexemeRow?.german ?? []).join(", "),
    contextNote: phraseRow ? phraseRow.contextNote : (lexemeRow?.notes ?? null),
    notes: phraseRow ? phraseRow.notes : (lexemeRow?.notes ?? null),
    status: row.status,
    source: row.source,
    register: row.register,
    regionLabel: row.regionLabel,
    difficulty: row.difficulty,
    tags: row.tags,
    partOfSpeech: lexemeRow?.partOfSpeech ?? null,
    gender: lexemeRow?.gender ?? null,
    aspect: lexemeRow?.aspect ?? null,
    audioCount: audio.length,
    humanAudioCount: audio.filter((a) => a.kind === "human_recording").length,
    updatedAt: row.updatedAt,
    audio: audio.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      speakerLabel: asset.speakerLabel,
      path: asset.path,
      fallbackPath: asset.fallbackPath,
      createdAt: asset.createdAt,
    })),
    inDeck: Boolean(cardRow),
  };
}

export type ContentEdit = {
  slovene?: string;
  german?: string;
  contextNote?: string | null;
  notes?: string | null;
  register?: "standard" | "colloquial" | "regional" | "formal";
  regionLabel?: string | null;
  tags?: string[];
  status?: ContentStatus;
  difficulty?: number;
};

/**
 * Edits one item. Changing the Slovene changes what the audio should sound
 * like, so the caller is told to regenerate — the audio pipeline keys on a
 * hash of the text and will produce a new file on the next run.
 */
export async function updateContentItem(
  db: Db,
  kind: ContentKind,
  id: string,
  edit: ContentEdit,
): Promise<{ textChanged: boolean }> {
  const now = new Date();

  if (kind === "phrase") {
    const [existing] = await db.select().from(phrases).where(eq(phrases.id, id)).limit(1);
    if (!existing) throw new Error("phrase not found");

    const slovene = edit.slovene?.trim() || existing.slovene;
    await db
      .update(phrases)
      .set({
        slovene,
        sloveneNormalized: normalizeSlovene(slovene),
        ...(edit.german !== undefined ? { german: edit.german } : {}),
        ...(edit.contextNote !== undefined ? { contextNote: edit.contextNote } : {}),
        ...(edit.notes !== undefined ? { notes: edit.notes } : {}),
        ...(edit.register ? { register: edit.register } : {}),
        ...(edit.regionLabel !== undefined ? { regionLabel: edit.regionLabel } : {}),
        ...(edit.tags ? { tags: edit.tags } : {}),
        ...(edit.status ? { status: edit.status } : {}),
        ...(edit.difficulty ? { difficulty: edit.difficulty } : {}),
        updatedAt: now,
      })
      .where(eq(phrases.id, id));

    return { textChanged: slovene !== existing.slovene };
  }

  const [existing] = await db.select().from(lexemes).where(eq(lexemes.id, id)).limit(1);
  if (!existing) throw new Error("lexeme not found");

  const slovene = edit.slovene?.trim() || existing.slovene;
  await db
    .update(lexemes)
    .set({
      slovene,
      sloveneNormalized: normalizeSlovene(slovene),
      ...(edit.german !== undefined
        ? { german: edit.german.split(",").map((part) => part.trim()).filter(Boolean) }
        : {}),
      ...(edit.notes !== undefined ? { notes: edit.notes } : {}),
      ...(edit.register ? { register: edit.register } : {}),
      ...(edit.regionLabel !== undefined ? { regionLabel: edit.regionLabel } : {}),
      ...(edit.tags ? { tags: edit.tags } : {}),
      ...(edit.status ? { status: edit.status } : {}),
      ...(edit.difficulty ? { difficulty: edit.difficulty } : {}),
      updatedAt: now,
    })
    .where(eq(lexemes.id, id));

  return { textChanged: slovene !== existing.slovene };
}

/**
 * Archiving hides an item from new sessions. Existing cards are suspended
 * rather than deleted: her review history stays intact, and un-archiving puts
 * the item back exactly where it was.
 */
export async function setArchived(
  db: Db,
  kind: ContentKind,
  id: string,
  archived: boolean,
): Promise<void> {
  const status = archived ? "archived" : "active";

  if (kind === "phrase") {
    await db.update(phrases).set({ status, updatedAt: new Date() }).where(eq(phrases.id, id));
  } else {
    await db.update(lexemes).set({ status, updatedAt: new Date() }).where(eq(lexemes.id, id));
  }

  await db
    .update(cards)
    .set({ suspended: archived, updatedAt: new Date() })
    .where(kind === "phrase" ? eq(cards.phraseId, id) : eq(cards.lexemeId, id));
}
