import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedSpeechRecord } from "@/lib/offline/store";

/**
 * uploadSpeech() decides whether a failed upload is safe to drop from the
 * queue. The one thing that must never happen: losing an irreplaceable
 * recording because her session merely expired, not because the recording
 * itself was rejected.
 */

const storeState = {
  pendingSpeech: [] as QueuedSpeechRecord[],
  forgotten: [] as string[],
};

vi.mock("@/lib/offline/store", () => ({
  pendingReviews: vi.fn(async () => []),
  forgetReviews: vi.fn(async () => {}),
  pendingSpeech: vi.fn(async () => storeState.pendingSpeech),
  forgetSpeech: vi.fn(async (ids: string[]) => {
    storeState.forgotten.push(...ids);
  }),
  saveBundle: vi.fn(async () => {}),
}));

function speechRecord(clientEventId: string): QueuedSpeechRecord {
  return {
    clientEventId,
    cardId: "00000000-0000-4000-8000-000000000000",
    recordedAt: "2026-09-01T00:00:00.000Z",
    mimeType: "audio/webm",
    blob: new Blob(["audio"], { type: "audio/webm" }),
  };
}

describe("uploading a queued recording", () => {
  beforeEach(() => {
    storeState.pendingSpeech = [];
    storeState.forgotten = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("forgets the recording once the server confirms it", async () => {
    storeState.pendingSpeech = [speechRecord("event-ok")];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );

    const { syncPending } = await import("@/lib/offline/sync-client");
    const result = await syncPending();

    expect(result.speech).toEqual({ uploaded: 1, failed: 0 });
    expect(storeState.forgotten).toEqual(["event-ok"]);
  });

  it.each([401, 403])(
    "keeps the recording queued on a %d instead of deleting it",
    async (status) => {
      storeState.pendingSpeech = [speechRecord("event-expired-session")];
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status })),
      );

      const { syncPending } = await import("@/lib/offline/sync-client");
      const result = await syncPending();

      expect(result.speech).toEqual({ uploaded: 0, failed: 1 });
      expect(storeState.forgotten).toEqual([]);
    },
  );

  it("still drops a recording the server rejects on its merits (404 card gone)", async () => {
    storeState.pendingSpeech = [speechRecord("event-bad-card")];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    const { syncPending } = await import("@/lib/offline/sync-client");
    const result = await syncPending();

    expect(result.speech).toEqual({ uploaded: 1, failed: 0 });
    expect(storeState.forgotten).toEqual(["event-bad-card"]);
  });
});
