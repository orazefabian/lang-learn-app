import { createHash } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * The media store: audio files on a volume, addressed by content hash so the
 * same text is never synthesised twice and an edited phrase gets a new path
 * automatically.
 */

export function mediaRoot(): string {
  return path.resolve(env().MEDIA_ROOT);
}

/**
 * Hash of everything that determines how the audio sounds. Changing the text,
 * the voice or the engine yields a different path, which is what makes
 * "regenerate on content edit" fall out for free.
 */
export function contentHash(parts: { text: string; voice: string; engine: string }): string {
  return createHash("sha256")
    .update(`${parts.engine} ${parts.voice} ${parts.text.trim()}`)
    .digest("hex");
}

const EXTENSIONS: Record<string, string> = {
  "audio/ogg": "opus",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
};

export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType.split(";")[0]?.trim() ?? ""] ?? "bin";
}

export function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const found = Object.entries(EXTENSIONS).find(([, ext]) => ext === extension);
  return found?.[0] ?? "application/octet-stream";
}

/** Relative path for generated speech, sharded so one directory stays small. */
export function ttsPath(hash: string, extension: string): string {
  return path.posix.join("tts", hash.slice(0, 2), `${hash}.${extension}`);
}

export function recordingPath(id: string, extension: string): string {
  return path.posix.join("recordings", id.slice(0, 2), `${id}.${extension}`);
}

export function attemptPath(id: string, extension: string, now = new Date()): string {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return path.posix.join("attempts", month, `${id}.${extension}`);
}

/**
 * Resolves a store-relative path to an absolute one, refusing anything that
 * would escape the media root. Every path that reaches the filesystem goes
 * through here, including paths read back out of the database.
 */
export function resolveMediaPath(relativePath: string): string {
  const root = mediaRoot();
  const resolved = path.resolve(root, relativePath);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error(`refusing to access ${relativePath} outside the media root`);
  }
  return resolved;
}

export async function writeMedia(relativePath: string, data: Buffer): Promise<number> {
  const absolute = resolveMediaPath(relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, data);
  return data.byteLength;
}

export async function readMedia(relativePath: string): Promise<Buffer> {
  return readFile(resolveMediaPath(relativePath));
}

export async function mediaExists(relativePath: string): Promise<boolean> {
  try {
    const info = await stat(resolveMediaPath(relativePath));
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function deleteMedia(relativePath: string): Promise<void> {
  try {
    await unlink(resolveMediaPath(relativePath));
  } catch {
    // Already gone is the desired end state.
  }
}
