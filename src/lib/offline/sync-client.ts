"use client";

import {
  forgetReviews,
  forgetSpeech,
  pendingReviews,
  pendingSpeech,
  saveBundle,
  type QueuedSpeechRecord,
} from "./store";
import type { OfflineBundle } from "./bundle";

/**
 * Getting the queue back to the server.
 *
 * Reviews go first and in one request, because they have to be applied in
 * order; recordings follow one at a time, because they are large and a failed
 * upload should not take the others with it.
 */

export type SyncResult = {
  reviews: { applied: number; duplicates: number; rejected: number };
  speech: { uploaded: number; failed: number };
};

export async function syncPending(): Promise<SyncResult> {
  const result: SyncResult = {
    reviews: { applied: 0, duplicates: 0, rejected: 0 },
    speech: { uploaded: 0, failed: 0 },
  };

  const reviews = await pendingReviews();
  if (reviews.length) {
    const response = await fetch("/api/offline/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviews }),
    });

    if (response.ok) {
      const body = (await response.json()) as {
        applied: number;
        duplicates: number;
        rejected: { clientEventId: string }[];
        settled: string[];
      };
      // Only what the server says it has seen is dropped.
      await forgetReviews(body.settled);
      result.reviews = {
        applied: body.applied,
        duplicates: body.duplicates,
        rejected: body.rejected.length,
      };
    }
  }

  for (const record of await pendingSpeech()) {
    if (await uploadSpeech(record)) {
      await forgetSpeech([record.clientEventId]);
      result.speech.uploaded += 1;
    } else {
      result.speech.failed += 1;
    }
  }

  return result;
}

async function uploadSpeech(record: QueuedSpeechRecord): Promise<boolean> {
  const form = new FormData();
  form.set("clientEventId", record.clientEventId);
  form.set("cardId", record.cardId);
  if (record.sessionId) form.set("sessionId", record.sessionId);
  form.set("recordedAt", record.recordedAt);
  if (record.durationMs) form.set("durationMs", String(record.durationMs));
  form.set("audio", record.blob, `attempt.${record.mimeType.split("/")[1] ?? "webm"}`);

  try {
    const response = await fetch("/api/offline/speech", { method: "POST", body: form });
    if (response.ok) return true;
    /*
     * A 4xx will never succeed on a retry — a card that has been deleted, or
     * audio the server will not take. Dropping it loses one recording; keeping
     * it would mean retrying forever on every reconnect.
     */
    return response.status >= 400 && response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Fetches the next session and stores it for later.
 *
 * Called when she is online and idle, so the bundle is already there the next
 * time she opens the app without a connection.
 */
export async function refreshBundle(): Promise<OfflineBundle | null> {
  try {
    const response = await fetch("/api/offline/bundle", { cache: "no-store" });
    if (!response.ok) return null;

    const body = (await response.json()) as { bundle: OfflineBundle | null };
    if (!body.bundle) return null;

    await saveBundle(body.bundle);
    void precacheAudio(body.bundle.audioUrls);
    return body.bundle;
  } catch {
    return null;
  }
}

const AUDIO_CACHE = "dober-dan-audio-v1";

/**
 * Pulls the session's audio into the cache the service worker reads from.
 *
 * Done here rather than in the worker so it is plain fetch with her cookies,
 * and so a failure is silent: audio missing offline costs her the listening
 * cards, not the session.
 */
export async function precacheAudio(urls: string[]): Promise<void> {
  if (typeof caches === "undefined" || !urls.length) return;

  try {
    const cache = await caches.open(AUDIO_CACHE);
    for (const url of urls) {
      if (await cache.match(url)) continue;
      try {
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      } catch {
        // One missing clip is not worth abandoning the rest.
      }
    }
  } catch {
    // No Cache API: listening cards will simply be silent offline.
  }
}
