import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { mediaAssets } from "@/db/schema";
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
