import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { mimeTypeForPath, resolveMediaPath } from "@/lib/audio/storage";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Serves audio off the media volume.
 *
 * Signed in only: the deck is not secret, but her speech attempts live on the
 * same volume and those are nobody else's business.
 */
function toWebStream(
  path: string,
  options?: { start: number; end: number },
): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(path, options);
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (error) => controller.error(error));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { path: segments } = await context.params;
  const relativePath = segments.map(decodeURIComponent).join("/");

  let absolute: string;
  try {
    absolute = resolveMediaPath(relativePath);
  } catch (error) {
    logger.warn({ relativePath }, "rejected media path outside the root");
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(absolute);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!info.isFile()) return NextResponse.json({ error: "not found" }, { status: 404 });

  const contentType = mimeTypeForPath(absolute);
  // TTS files are addressed by content hash, so they can be cached forever.
  const cacheControl = relativePath.startsWith("tts/")
    ? "private, max-age=31536000, immutable"
    : "private, max-age=3600";

  const range = request.headers.get("range");
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match[2] ? Number.parseInt(match[2], 10) : info.size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= info.size) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${info.size}` },
        });
      }

      const clampedEnd = Math.min(end, info.size - 1);
      return new NextResponse(toWebStream(absolute, { start, end: clampedEnd }), {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(clampedEnd - start + 1),
          "Content-Range": `bytes ${start}-${clampedEnd}/${info.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": cacheControl,
        },
      });
    }
  }

  return new NextResponse(toWebStream(absolute), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(info.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
    },
  });
}
