import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let storage: typeof import("@/lib/audio/storage");
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "slo-media-"));
  process.env.MEDIA_ROOT = root;
  process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
  storage = await import("@/lib/audio/storage");
});

describe("content hashing", () => {
  it("gives the same text, voice and engine the same hash", () => {
    const parts = { text: "Dober dan", voice: "sl_SI-artur-medium", engine: "piper" };
    expect(storage.contentHash(parts)).toBe(storage.contentHash(parts));
  });

  it("ignores surrounding whitespace", () => {
    const a = storage.contentHash({ text: " Dober dan ", voice: "v", engine: "piper" });
    const b = storage.contentHash({ text: "Dober dan", voice: "v", engine: "piper" });
    expect(a).toBe(b);
  });

  /** This is what makes "regenerate on content edit" work without extra logic. */
  it("changes when the text changes", () => {
    const a = storage.contentHash({ text: "Dober dan", voice: "v", engine: "piper" });
    const b = storage.contentHash({ text: "Dober dan!", voice: "v", engine: "piper" });
    expect(a).not.toBe(b);
  });

  it("changes when the voice or engine changes", () => {
    const base = { text: "Dober dan", voice: "a", engine: "piper" };
    expect(storage.contentHash(base)).not.toBe(storage.contentHash({ ...base, voice: "b" }));
    expect(storage.contentHash(base)).not.toBe(storage.contentHash({ ...base, engine: "other" }));
  });

  it("distinguishes diacritics — they change how it sounds", () => {
    const a = storage.contentHash({ text: "Živjo", voice: "v", engine: "piper" });
    const b = storage.contentHash({ text: "Zivjo", voice: "v", engine: "piper" });
    expect(a).not.toBe(b);
  });
});

describe("paths", () => {
  it("shards generated speech by the first byte of the hash", () => {
    const hash = "abcdef0123456789";
    expect(storage.ttsPath(hash, "opus")).toBe(`tts/ab/${hash}.opus`);
  });

  it("files speech attempts by month, so retention is easy to reason about", () => {
    const march = new Date("2026-03-15T12:00:00.000Z");
    expect(storage.attemptPath("attempt-id", "webm", march)).toBe(
      "attempts/2026-03/attempt-id.webm",
    );
  });

  it("maps mime types to extensions and back", () => {
    expect(storage.extensionFor("audio/ogg")).toBe("opus");
    expect(storage.extensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(storage.mimeTypeForPath("tts/ab/hash.mp3")).toBe("audio/mpeg");
    expect(storage.mimeTypeForPath("a/b/c.unknown")).toBe("application/octet-stream");
  });
});

describe("path safety", () => {
  it("resolves paths inside the media root", () => {
    expect(storage.resolveMediaPath("tts/ab/hash.opus")).toBe(
      path.join(root, "tts/ab/hash.opus"),
    );
  });

  /** Paths reach this from the database and from URLs; both are untrusted. */
  it("refuses to escape the media root", () => {
    for (const attempt of [
      "../secrets.env",
      "tts/../../etc/passwd",
      "/etc/passwd",
      "tts/ab/../../../..",
    ]) {
      expect(() => storage.resolveMediaPath(attempt), attempt).toThrow(/outside the media root/);
    }
  });

  it("allows a path that merely starts with the root's name", () => {
    expect(() => storage.resolveMediaPath("tts-extra/file.opus")).not.toThrow();
  });
});

describe("reading and writing", () => {
  it("writes, reads back, reports existence and deletes", async () => {
    const relative = storage.ttsPath("deadbeef00", "opus");
    const payload = Buffer.from("not really audio, but bytes are bytes");

    expect(await storage.mediaExists(relative)).toBe(false);

    const size = await storage.writeMedia(relative, payload);
    expect(size).toBe(payload.byteLength);
    expect(await storage.mediaExists(relative)).toBe(true);
    expect((await storage.readMedia(relative)).toString()).toBe(payload.toString());
    expect((await readFile(path.join(root, relative))).byteLength).toBe(payload.byteLength);

    await storage.deleteMedia(relative);
    expect(await storage.mediaExists(relative)).toBe(false);
  });

  it("treats a zero-byte file as missing, so a failed write is retried", async () => {
    const relative = storage.ttsPath("empty00", "opus");
    await storage.writeMedia(relative, Buffer.alloc(0));
    expect(await storage.mediaExists(relative)).toBe(false);
  });

  it("deleting something that is already gone is not an error", async () => {
    await expect(storage.deleteMedia("tts/zz/never-existed.opus")).resolves.toBeUndefined();
  });
});
