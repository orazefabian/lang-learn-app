import { desc, eq, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { mediaAssets } from "@/db/schema";

/**
 * Picking which audio to play.
 *
 * Human recordings always win. Hearing the actual voices of the people she
 * will talk to is the point of this app, not a nice-to-have — a generated voice
 * is what plays when no one has recorded the phrase yet.
 */

export type PlayableAudio = {
  id: string;
  kind: "tts" | "human_recording";
  /** URL the browser can fetch. */
  src: string;
  /** mp3 twin for players that will not take Opus. */
  fallbackSrc: string | null;
  speakerLabel: string | null;
  durationMs: number | null;
};

export function mediaUrl(relativePath: string): string {
  return `/api/media/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function toPlayable(asset: typeof mediaAssets.$inferSelect): PlayableAudio {
  return {
    id: asset.id,
    kind: asset.kind,
    src: mediaUrl(asset.path),
    fallbackSrc: asset.fallbackPath ? mediaUrl(asset.fallbackPath) : null,
    speakerLabel: asset.speakerLabel,
    durationMs: asset.durationMs,
  };
}

/**
 * Every recording for an item, best first. The first entry is what plays; the
 * rest are the alternates she can flick through — "and this is how Oma says it".
 */
export function sortAudio(assets: (typeof mediaAssets.$inferSelect)[]): PlayableAudio[] {
  return [...assets]
    .sort((a, b) => {
      // Human before generated, whatever the priority numbers say.
      if (a.kind !== b.kind) return a.kind === "human_recording" ? -1 : 1;
      if (a.priority !== b.priority) return b.priority - a.priority;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .map(toPlayable);
}

export async function getAudioForItem(
  db: Db,
  item: { phraseId?: string | null; lexemeId?: string | null },
): Promise<PlayableAudio[]> {
  const conditions = [];
  if (item.phraseId) conditions.push(eq(mediaAssets.phraseId, item.phraseId));
  if (item.lexemeId) conditions.push(eq(mediaAssets.lexemeId, item.lexemeId));
  if (!conditions.length) return [];

  const assets = await db
    .select()
    .from(mediaAssets)
    .where(conditions.length === 1 ? conditions[0] : or(...conditions))
    .orderBy(desc(mediaAssets.priority));

  return sortAudio(assets);
}
