"use client";

import type { OfflineBundle } from "./bundle";

/**
 * The browser's half of offline review.
 *
 * IndexedDB rather than localStorage because recordings are blobs, and because
 * the queue must survive the tab being killed mid-session — which on a phone
 * is the normal way an app closes, not an edge case.
 *
 * Everything here degrades to a no-op when IndexedDB is unavailable (private
 * windows, storage denied). Offline review stops working; the app does not.
 */

const DB_NAME = "dober-dan-offline";
const DB_VERSION = 1;

const BUNDLE_STORE = "bundle";
const REVIEW_STORE = "reviews";
const SPEECH_STORE = "speech";

export type QueuedReviewRecord = {
  clientEventId: string;
  sessionId: string;
  cardId: string;
  rating: "again" | "hard" | "good" | "easy";
  reviewedAt: string;
  durationMs?: number;
  ratingSource?: "manual" | "auto_speech" | "overridden";
};

export type QueuedSpeechRecord = {
  clientEventId: string;
  cardId: string;
  sessionId?: string;
  recordedAt: string;
  durationMs?: number;
  mimeType: string;
  blob: Blob;
};

let handle: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BUNDLE_STORE)) {
        database.createObjectStore(BUNDLE_STORE);
      }
      if (!database.objectStoreNames.contains(REVIEW_STORE)) {
        database.createObjectStore(REVIEW_STORE, { keyPath: "clientEventId" });
      }
      if (!database.objectStoreNames.contains(SPEECH_STORE)) {
        database.createObjectStore(SPEECH_STORE, { keyPath: "clientEventId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function database(): Promise<IDBDatabase | null> {
  handle ??= openDatabase();
  return handle;
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return database().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        let request: IDBRequest<T>;
        try {
          request = action(db.transaction(storeName, mode).objectStore(storeName));
        } catch {
          resolve(null);
          return;
        }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      }),
  );
}

/** True when the browser will actually let us do any of this. */
export async function isOfflineStorageAvailable(): Promise<boolean> {
  return (await database()) !== null;
}

// --- the cached session -----------------------------------------------------

export async function saveBundle(bundle: OfflineBundle): Promise<void> {
  await run(BUNDLE_STORE, "readwrite", (store) => store.put(bundle, "current"));
}

export async function loadBundle(): Promise<OfflineBundle | null> {
  return (await run<OfflineBundle>(BUNDLE_STORE, "readonly", (store) =>
    store.get("current"),
  )) as OfflineBundle | null;
}

export async function clearBundle(): Promise<void> {
  await run(BUNDLE_STORE, "readwrite", (store) => store.delete("current"));
}

/**
 * How far through the cached session she has got.
 *
 * Kept separately from the bundle so advancing a card is one small write
 * rather than rewriting every prompt and its answers.
 */
export async function saveCursor(sessionId: string, cursor: number): Promise<void> {
  await run(BUNDLE_STORE, "readwrite", (store) => store.put({ sessionId, cursor }, "cursor"));
}

export async function loadCursor(): Promise<{ sessionId: string; cursor: number } | null> {
  return (await run<{ sessionId: string; cursor: number }>(BUNDLE_STORE, "readonly", (store) =>
    store.get("cursor"),
  )) as { sessionId: string; cursor: number } | null;
}

// --- the queues -------------------------------------------------------------

export async function queueReview(record: QueuedReviewRecord): Promise<void> {
  await run(REVIEW_STORE, "readwrite", (store) => store.put(record));
}

export async function pendingReviews(): Promise<QueuedReviewRecord[]> {
  const rows = await run<QueuedReviewRecord[]>(REVIEW_STORE, "readonly", (store) =>
    store.getAll(),
  );
  return (rows ?? []).sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
}

export async function queueSpeech(record: QueuedSpeechRecord): Promise<void> {
  await run(SPEECH_STORE, "readwrite", (store) => store.put(record));
}

export async function pendingSpeech(): Promise<QueuedSpeechRecord[]> {
  const rows = await run<QueuedSpeechRecord[]>(SPEECH_STORE, "readonly", (store) => store.getAll());
  return (rows ?? []).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

async function forget(storeName: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await database();
  if (!db) return;
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  for (const id of ids) store.delete(id);
  await new Promise<void>((resolve) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

export const forgetReviews = (ids: string[]) => forget(REVIEW_STORE, ids);
export const forgetSpeech = (ids: string[]) => forget(SPEECH_STORE, ids);

export async function pendingCount(): Promise<number> {
  const [reviews, speech] = await Promise.all([pendingReviews(), pendingSpeech()]);
  return reviews.length + speech.length;
}

/** A client-side id for one answer. Crypto if available, timestamped if not. */
export function newEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
