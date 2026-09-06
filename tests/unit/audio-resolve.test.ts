import { describe, expect, it } from "vitest";
import { mediaUrl, sortAudio } from "@/lib/audio/resolve";

type Asset = Parameters<typeof sortAudio>[0][number];

function asset(partial: Partial<Asset> & { id: string }): Asset {
  return {
    id: partial.id,
    kind: partial.kind ?? "tts",
    lexemeId: null,
    phraseId: null,
    speakerLabel: partial.speakerLabel ?? null,
    path: partial.path ?? `tts/ab/${partial.id}.opus`,
    mimeType: "audio/ogg",
    fallbackPath: partial.fallbackPath ?? null,
    durationMs: partial.durationMs ?? null,
    byteSize: null,
    contentHash: null,
    voice: null,
    priority: partial.priority ?? 0,
    createdBy: null,
    createdAt: partial.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
  } as Asset;
}

describe("choosing which recording to play", () => {
  /**
   * The whole point of the app: she should hear the people she will talk to,
   * not a synthesiser, whenever a human recording exists.
   */
  it("puts human recordings ahead of generated speech", () => {
    const sorted = sortAudio([
      asset({ id: "tts", kind: "tts" }),
      asset({ id: "oma", kind: "human_recording", speakerLabel: "Oma" }),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["oma", "tts"]);
    expect(sorted[0]?.speakerLabel).toBe("Oma");
  });

  it("prefers a human recording even when the generated one has higher priority", () => {
    const sorted = sortAudio([
      asset({ id: "tts", kind: "tts", priority: 99 }),
      asset({ id: "papa", kind: "human_recording", speakerLabel: "Papa", priority: 0 }),
    ]);
    expect(sorted[0]?.id).toBe("papa");
  });

  it("orders several human recordings by priority, then newest first", () => {
    const sorted = sortAudio([
      asset({
        id: "old",
        kind: "human_recording",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      asset({
        id: "new",
        kind: "human_recording",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
      }),
      asset({ id: "pinned", kind: "human_recording", priority: 10 }),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["pinned", "new", "old"]);
  });

  it("keeps every alternate so she can hear the other voices", () => {
    const sorted = sortAudio([
      asset({ id: "tts", kind: "tts" }),
      asset({ id: "oma", kind: "human_recording", speakerLabel: "Oma" }),
      asset({ id: "papa", kind: "human_recording", speakerLabel: "Papa" }),
    ]);
    expect(sorted).toHaveLength(3);
  });

  it("exposes the mp3 fallback when there is one", () => {
    const sorted = sortAudio([
      asset({ id: "a", path: "tts/ab/a.opus", fallbackPath: "tts/ab/a.mp3" }),
    ]);
    expect(sorted[0]?.src).toBe("/api/media/tts/ab/a.opus");
    expect(sorted[0]?.fallbackSrc).toBe("/api/media/tts/ab/a.mp3");
  });

  it("reports no fallback rather than a broken URL", () => {
    expect(sortAudio([asset({ id: "a" })])[0]?.fallbackSrc).toBeNull();
  });

  it("returns nothing when an item has no audio at all", () => {
    expect(sortAudio([])).toEqual([]);
  });
});

describe("media URLs", () => {
  it("routes through the authenticated media endpoint", () => {
    expect(mediaUrl("tts/ab/hash.opus")).toBe("/api/media/tts/ab/hash.opus");
  });

  it("encodes each segment without mangling the separators", () => {
    expect(mediaUrl("recordings/ab/ime z presledkom.webm")).toBe(
      "/api/media/recordings/ab/ime%20z%20presledkom.webm",
    );
  });
});
