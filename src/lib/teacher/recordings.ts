import { randomUUID } from "node:crypto";
import { and, asc, count, eq, notExists, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { lexemes, mediaAssets, phrases } from "@/db/schema";
import { deleteMedia, extensionFor, recordingPath, writeMedia } from "@/lib/audio/storage";

/**
 * Human recordings.
 *
 * These are the point of the app, not a nice-to-have: hearing the actual voices
 * of the people she will talk to is why it exists. A recording always outranks
 * generated speech on the card, and the speaker label — "Oma", "Papa", "ich" —
 * is shown with it.
 */

export type AddRecordingInput = {
  kind: "phrase" | "lexeme";
  itemId: string;
  audio: Buffer;
  mimeType: string;
  /** Who is speaking. Shown to her, so it should read like a person. */
  speakerLabel: string;
  durationMs?: number;
  createdBy: string;
};

const ALLOWED = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"];
const MAX_BYTES = 25 * 1024 * 1024;

export async function addHumanRecording(
  db: Db,
  input: AddRecordingInput,
): Promise<{ id: string; path: string }> {
  const mimeType = input.mimeType.split(";")[0]?.trim() ?? "audio/webm";
  if (!ALLOWED.includes(mimeType)) throw new Error(`unsupported audio type ${mimeType}`);
  if (!input.audio.length) throw new Error("the recording was empty");
  if (input.audio.length > MAX_BYTES) throw new Error("the recording is too large");

  const label = input.speakerLabel.trim();
  if (!label) throw new Error("a speaker label is required");

  const id = randomUUID();
  const path = recordingPath(id, extensionFor(mimeType));
  const byteSize = await writeMedia(path, input.audio);

  const [asset] = await db
    .insert(mediaAssets)
    .values({
      id,
      kind: "human_recording",
      phraseId: input.kind === "phrase" ? input.itemId : null,
      lexemeId: input.kind === "lexeme" ? input.itemId : null,
      speakerLabel: label,
      path,
      mimeType,
      byteSize,
      durationMs: input.durationMs ?? null,
      // Sorting already puts human recordings first; priority orders them
      // among themselves when there is more than one voice.
      priority: 1,
      createdBy: input.createdBy,
    })
    .returning({ id: mediaAssets.id });

  if (!asset) throw new Error("could not save the recording");
  return { id: asset.id, path };
}

/** Removes a recording and its file. Generated audio is left alone. */
export async function removeRecording(db: Db, assetId: string): Promise<void> {
  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.id, assetId))
    .limit(1);
  if (!asset) return;
  if (asset.kind !== "human_recording") {
    throw new Error("only human recordings can be removed here");
  }

  await db.delete(mediaAssets).where(eq(mediaAssets.id, assetId));
  await deleteMedia(asset.path);
  if (asset.fallbackPath) await deleteMedia(asset.fallbackPath);
}

/** Moves one recording to the front when an item has several voices. */
export async function promoteRecording(db: Db, assetId: string): Promise<void> {
  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.id, assetId))
    .limit(1);
  if (!asset) return;

  const siblings = await db
    .select({ id: mediaAssets.id, priority: mediaAssets.priority })
    .from(mediaAssets)
    .where(
      asset.phraseId
        ? eq(mediaAssets.phraseId, asset.phraseId)
        : eq(mediaAssets.lexemeId, asset.lexemeId as string),
    );

  const highest = Math.max(0, ...siblings.map((row) => row.priority));
  await db
    .update(mediaAssets)
    .set({ priority: highest + 1 })
    .where(eq(mediaAssets.id, assetId));
}

/**
 * The recording queue: everything nobody has said out loud yet.
 *
 * `NOT EXISTS` in SQL rather than a filter over a page of rows. The content
 * browser does the latter — it filters after its own LIMIT — which is fine for
 * browsing but cannot walk a backlog of a few hundred items: the page shrinks
 * as recordings land and anything past the first LIMIT rows is unreachable.
 *
 * The order is "what is worth recording first". Phrases come before single
 * words because a phrase is what she will actually say at the table, and
 * within each, the easy and the frequent come first — those are the ones she
 * meets most often, so they are the ones worth a real voice soonest.
 */
export type RecordingQueueItem = {
  kind: "phrase" | "lexeme";
  id: string;
  slovene: string;
  german: string;
  contextNote: string | null;
};

export async function countMissingRecordings(
  db: Db,
): Promise<{ phrases: number; lexemes: number; total: number }> {
  const [phraseRow] = await db
    .select({ value: count() })
    .from(phrases)
    .where(
      and(
        eq(phrases.status, "active"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(mediaAssets)
            .where(
              and(
                eq(mediaAssets.phraseId, phrases.id),
                eq(mediaAssets.kind, "human_recording"),
              ),
            ),
        ),
      ),
    );

  const [lexemeRow] = await db
    .select({ value: count() })
    .from(lexemes)
    .where(
      and(
        eq(lexemes.status, "active"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(mediaAssets)
            .where(
              and(
                eq(mediaAssets.lexemeId, lexemes.id),
                eq(mediaAssets.kind, "human_recording"),
              ),
            ),
        ),
      ),
    );

  const phraseCount = phraseRow?.value ?? 0;
  const lexemeCount = lexemeRow?.value ?? 0;
  return { phrases: phraseCount, lexemes: lexemeCount, total: phraseCount + lexemeCount };
}

/**
 * The next batch to record, from the head of the queue.
 *
 * There is no offset on purpose. A recorded item leaves the queue, so the head
 * is always the next thing that needs a voice — paging by offset would skip
 * items as the queue shortened underneath it. The client works through a batch
 * and asks for another when it runs out.
 */
export async function getRecordingQueue(
  db: Db,
  options: { limit?: number } = {},
): Promise<RecordingQueueItem[]> {
  const limit = options.limit ?? 25;

  const phraseRows = await db
    .select({
      id: phrases.id,
      slovene: phrases.slovene,
      german: phrases.german,
      contextNote: phrases.contextNote,
    })
    .from(phrases)
    .where(
      and(
        eq(phrases.status, "active"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(mediaAssets)
            .where(
              and(
                eq(mediaAssets.phraseId, phrases.id),
                eq(mediaAssets.kind, "human_recording"),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(phrases.difficulty), asc(phrases.createdAt))
    .limit(limit);

  const items: RecordingQueueItem[] = phraseRows.map((row) => ({
    kind: "phrase" as const,
    id: row.id,
    slovene: row.slovene,
    german: row.german,
    contextNote: row.contextNote,
  }));

  if (items.length >= limit) return items;

  const lexemeRows = await db
    .select({
      id: lexemes.id,
      slovene: lexemes.slovene,
      german: lexemes.german,
      notes: lexemes.notes,
      frequencyRank: lexemes.frequencyRank,
    })
    .from(lexemes)
    .where(
      and(
        eq(lexemes.status, "active"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(mediaAssets)
            .where(
              and(
                eq(mediaAssets.lexemeId, lexemes.id),
                eq(mediaAssets.kind, "human_recording"),
              ),
            ),
        ),
      ),
    )
    // Commonest words first; the unranked ones trail rather than lead.
    .orderBy(sql`${lexemes.frequencyRank} asc nulls last`, asc(lexemes.createdAt))
    .limit(limit - items.length);

  items.push(
    ...lexemeRows.map((row) => ({
      kind: "lexeme" as const,
      id: row.id,
      slovene: row.slovene,
      german: row.german.join(", "),
      contextNote: row.notes,
    })),
  );

  return items;
}
