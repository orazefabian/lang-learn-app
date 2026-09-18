import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedSpeechRecord } from "./store";

const { pendingSpeech, forgetSpeech, pendingReviews } = vi.hoisted(() => ({
  pendingSpeech: vi.fn(),
  forgetSpeech: vi.fn(),
  pendingReviews: vi.fn(),
}));

vi.mock("./store", () => ({
  pendingReviews,
  pendingSpeech,
  forgetReviews: vi.fn(),
  forgetSpeech,
  saveBundle: vi.fn(),
}));

const { syncPending } = await import("./sync-client");

function queuedSpeech(): QueuedSpeechRecord {
  return {
    clientEventId: "speech-0001",
    cardId: "11111111-1111-4111-8111-111111111111",
    recordedAt: "2026-09-02T19:00:00Z",
    mimeType: "audio/webm",
    blob: new Blob(["audio"], { type: "audio/webm" }),
  };
}

describe("syncing a queued recording", () => {
  beforeEach(() => {
    pendingReviews.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    pendingSpeech.mockReset();
    forgetSpeech.mockReset();
    pendingReviews.mockReset();
  });

  it("keeps the recording queued on an expired session instead of deleting it", async () => {
    pendingSpeech.mockResolvedValue([queuedSpeech()]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    const result = await syncPending();

    expect(forgetSpeech).not.toHaveBeenCalled();
    expect(result.speech).toEqual({ uploaded: 0, failed: 1 });
  });

  it("still drops a recording the server explicitly rejects as unusable", async () => {
    pendingSpeech.mockResolvedValue([queuedSpeech()]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );

    const result = await syncPending();

    expect(forgetSpeech).toHaveBeenCalledWith(["speech-0001"]);
    expect(result.speech).toEqual({ uploaded: 1, failed: 0 });
  });
});
