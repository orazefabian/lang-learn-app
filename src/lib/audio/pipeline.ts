import { and, eq, isNull, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { lexemes, mediaAssets, phrases } from "@/db/schema";
import { logger } from "@/lib/logger";
import {
  contentHash,
  deleteMedia,
  mediaExists,
  ttsPath,
  writeMedia,
} from "./storage";
import { getTtsClient, TtsUnavailableError, type TtsClient } from "./tts";

/**
 * Audio generation happens when content is created or edited, never while she
 * is waiting for a card. Files are keyed by a hash of (engine, voice, text), so
 * an unchanged phrase is never re-synthesised and an edited one gets a fresh
 * path automatically.
 */

export type AudioTarget =
  | { kind: "phrase"; id: string; text: string }
  | { kind: "lexeme"; id: string; text: string };

export type EnsureAudioResult = {
  status: "created" | "reused" | "skipped" | "failed";
  mediaAssetId?: string;
  reason?: string;
};

/**
 * Opus for size, mp3 alongside it for players that need it. Both are generated
 * up front — discovering at playback time that the fallback is missing would
 * mean a silent card.
 */
async function synthesizePair(
  client: TtsClient,
  text: string,
  voice: string,
  hash: string,
): Promise<{ path: string; fallbackPath: string; byteSize: number }> {
  const primary = ttsPath(hash, "opus");
  const fallback = ttsPath(hash, "mp3");

  let byteSize = 0;

  if (!(await mediaExists(primary))) {
    const result = await client.synthesize({ text, format: "opus", voice });
    byteSize = await writeMedia(primary, result.audio);
  }

  if (!(await mediaExists(fallback))) {
    try {
      const result = await client.synthesize({ text, format: "mp3", voice });
      await writeMedia(fallback, result.audio);
    } catch (error) {
      // A missing fallback is a degradation, not a failure: Opus plays
      // everywhere that matters. Leave the primary in place and say so.
      logger.warn({ err: error, text }, "mp3 fallback could not be generated");
      await deleteMedia(fallback);
      return { path: primary, fallbackPath: "", byteSize };
    }
  }

  return { path: primary, fallbackPath: fallback, byteSize };
}

/**
 * Makes sure one item has current TTS audio.
 *
 * Existing assets whose hash no longer matches the item's text are archived by
 * deletion of the row, not of the file — a stale file costs a few kilobytes,
 * while deleting one still referenced elsewhere would cost a silent card.
 */
export async function ensureTtsAudio(
  db: Db,
  target: AudioTarget,
  options: { voice?: string; client?: TtsClient; force?: boolean } = {},
): Promise<EnsureAudioResult> {
  const client = options.client ?? getTtsClient();
  const text = target.text.trim();
  if (!text) return { status: "skipped", reason: "empty text" };

  const voice = options.voice ?? process.env.PIPER_VOICE ?? "sl_SI-artur-medium";
  const hash = contentHash({ text, voice, engine: client.engine });

  const where =
    target.kind === "phrase"
      ? and(eq(mediaAssets.phraseId, target.id), eq(mediaAssets.kind, "tts"))
      : and(eq(mediaAssets.lexemeId, target.id), eq(mediaAssets.kind, "tts"));

  const existing = await db.select().from(mediaAssets).where(where);

  const current = existing.find((asset) => asset.contentHash === hash);
  if (current && !options.force && (await mediaExists(current.path))) {
    return { status: "reused", mediaAssetId: current.id };
  }

  try {
    const files = await synthesizePair(client, text, voice, hash);

    // Drop rows for text that no longer exists, so the card does not offer
    // audio of a phrase that has since been rewritten.
    for (const stale of existing) {
      if (stale.contentHash !== hash) {
        await db.delete(mediaAssets).where(eq(mediaAssets.id, stale.id));
      }
    }

    if (current) {
      await db
        .update(mediaAssets)
        .set({
          path: files.path,
          fallbackPath: files.fallbackPath || null,
          byteSize: files.byteSize || current.byteSize,
        })
        .where(eq(mediaAssets.id, current.id));
      return { status: "created", mediaAssetId: current.id };
    }

    const [inserted] = await db
      .insert(mediaAssets)
      .values({
        kind: "tts",
        lexemeId: target.kind === "lexeme" ? target.id : null,
        phraseId: target.kind === "phrase" ? target.id : null,
        speakerLabel: voice,
        path: files.path,
        fallbackPath: files.fallbackPath || null,
        mimeType: "audio/ogg",
        byteSize: files.byteSize || null,
        contentHash: hash,
        voice,
        // Human recordings sort above generated speech.
        priority: 0,
      })
      .returning({ id: mediaAssets.id });

    return { status: "created", mediaAssetId: inserted?.id };
  } catch (error) {
    if (error instanceof TtsUnavailableError) {
      return { status: "skipped", reason: error.message };
    }
    logger.error({ err: error, target }, "tts generation failed");
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

export type BatchAudioReport = {
  created: number;
  reused: number;
  skipped: number;
  failed: number;
  failures: { text: string; reason: string }[];
};

/**
 * Generates audio for every active phrase and glossed lexeme that lacks it.
 * Run after seeding, after approving AI drafts, or after a bulk edit.
 */
export async function generateMissingAudio(
  db: Db,
  options: {
    client?: TtsClient;
    limit?: number;
    includeDrafts?: boolean;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<BatchAudioReport> {
  const client = options.client ?? getTtsClient();
  const report: BatchAudioReport = {
    created: 0,
    reused: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  if (!(await client.isAvailable())) {
    report.skipped = 1;
    report.failures.push({
      text: "-",
      reason: "no text-to-speech service reachable (check PIPER_URL)",
    });
    return report;
  }

  const statuses = options.includeDrafts ? ["active", "draft"] : ["active"];

  const phraseRows = await db
    .select({ id: phrases.id, text: phrases.slovene })
    .from(phrases)
    .where(or(...statuses.map((status) => eq(phrases.status, status as "active"))))
    .limit(options.limit ?? 5000);

  const lexemeRows = await db
    .select({ id: lexemes.id, text: lexemes.slovene })
    .from(lexemes)
    .where(or(...statuses.map((status) => eq(lexemes.status, status as "active"))))
    .limit(options.limit ?? 5000);

  const targets: AudioTarget[] = [
    ...phraseRows.map((row) => ({ kind: "phrase" as const, id: row.id, text: row.text })),
    ...lexemeRows.map((row) => ({ kind: "lexeme" as const, id: row.id, text: row.text })),
  ];

  for (const [index, target] of targets.entries()) {
    const result = await ensureTtsAudio(db, target, { client });
    report[result.status] += 1;
    if (result.status === "failed" && result.reason) {
      report.failures.push({ text: target.text, reason: result.reason });
    }
    options.onProgress?.(index + 1, targets.length);
  }

  return report;
}

/** Media assets whose file has gone missing from the volume. */
export async function findOrphanedAssets(db: Db): Promise<string[]> {
  const assets = await db
    .select({ id: mediaAssets.id, path: mediaAssets.path })
    .from(mediaAssets)
    .where(or(isNull(mediaAssets.fallbackPath), eq(mediaAssets.kind, "tts")));

  const missing: string[] = [];
  for (const asset of assets) {
    if (!(await mediaExists(asset.path))) missing.push(asset.id);
  }
  return missing;
}
