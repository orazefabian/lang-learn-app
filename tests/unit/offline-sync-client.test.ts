import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadSpeech } from "@/lib/offline/sync-client";
import type { QueuedSpeechRecord } from "@/lib/offline/store";

function record(): QueuedSpeechRecord {
  return {
    clientEventId: "speech-event-0001",
    cardId: "00000000-0000-4000-8000-000000000000",
    recordedAt: "2026-09-02T19:30:00Z",
    mimeType: "audio/webm",
    blob: new Blob(["audio"], { type: "audio/webm" }),
  };
}

describe("uploadSpeech", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports success on a 2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );

    await expect(uploadSpeech(record())).resolves.toBe(true);
  });

  /**
   * The bug this guards against: an expired session on reconnect must not
   * look like "the recording was bad" — that would permanently delete a
   * speech recording that was never actually stored on the server.
   */
  it.each([401, 403])(
    "keeps the recording queued on a %d auth failure",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status })),
      );

      await expect(uploadSpeech(record())).resolves.toBe(false);
    },
  );

  it.each([400, 404, 413, 415])(
    "drops the recording on a %d content-level rejection",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status })),
      );

      await expect(uploadSpeech(record())).resolves.toBe(true);
    },
  );

  it("keeps the recording queued on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network error")),
    );

    await expect(uploadSpeech(record())).resolves.toBe(false);
  });
});
