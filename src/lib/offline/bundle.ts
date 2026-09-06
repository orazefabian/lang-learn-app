import type { Db } from "@/db/client";
import {
  getCardPrompt,
  getSettings,
  startOrResumeSession,
  type CardPrompt,
} from "@/lib/session/service";

/**
 * Everything a review session needs, in one response.
 *
 * The online session fetches cards one at a time so upcoming answers are never
 * sitting in the browser. Offline that is not an option — the answers have to
 * travel with the cards, because there is nobody to ask later. The trade is
 * deliberate and limited to this route: it is her own deck, on her own phone,
 * and the alternative is no offline session at all.
 */

export type OfflineBundle = {
  sessionId: string;
  cursor: number;
  total: number;
  cards: CardPrompt[];
  /** URLs to pre-cache, in the order the cards will need them. */
  audioUrls: string[];
  builtAt: string;
  autoplayAudio: boolean;
};

export async function buildOfflineBundle(
  db: Db,
  userId: string,
): Promise<OfflineBundle | null> {
  const session = await startOrResumeSession(db, userId);
  if (!session.queue.length) return null;

  const prompts: CardPrompt[] = [];
  for (const cardId of session.queue) {
    const prompt = await getCardPrompt(db, cardId);
    if (prompt) prompts.push(prompt);
  }

  // Only the first source per card: the alternates are a nice-to-have online
  // and would multiply the download for no gain on a phone in a tunnel.
  const audioUrls = [
    ...new Set(
      prompts
        .map((prompt) => prompt.audio[0]?.src)
        .filter((src): src is string => Boolean(src)),
    ),
  ];

  return {
    sessionId: session.sessionId,
    cursor: session.cursor,
    total: session.queue.length,
    cards: prompts,
    audioUrls,
    builtAt: new Date().toISOString(),
    autoplayAudio: (await getSettings(db, userId)).autoplayAudio,
  };
}
