import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { currentUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { knownSpeechEvents } from "@/lib/offline/sync";
import { getCardPrompt } from "@/lib/session/service";

export const dynamic = "force-dynamic";

const ALLOWED_AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"];
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const metaSchema = z.object({
  clientEventId: z.string().min(8).max(64),
  cardId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  recordedAt: z.iso.datetime().optional(),
  durationMs: z.coerce.number().int().nonnegative().optional(),
});

/**
 * One recording made while offline.
 *
 * Uploaded on reconnect and scored here if Whisper answers — which it usually
 * will, since being back online is the whole reason this ran. If it does not,
 * the attempt stays pending and the existing catch-up path scores it later.
 * Either way the audio is safe, which is the part that cannot be redone.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const parsed = metaSchema.safeParse({
    clientEventId: formData.get("clientEventId"),
    cardId: formData.get("cardId"),
    sessionId: formData.get("sessionId") ?? undefined,
    recordedAt: formData.get("recordedAt") ?? undefined,
    durationMs: formData.get("durationMs") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  // Uploaded twice is a retry, not a second attempt.
  const known = await knownSpeechEvents(db, user.id, [parsed.data.clientEventId]);
  if (known.has(parsed.data.clientEventId)) {
    return NextResponse.json({ status: "duplicate", settled: true });
  }

  const file = formData.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no audio" }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "recording too large" }, { status: 413 });
  }

  const mimeType = (file.type || "audio/webm").split(";")[0]?.trim() ?? "audio/webm";
  if (!ALLOWED_AUDIO_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: `unsupported audio type ${mimeType}` }, { status: 415 });
  }

  const prompt = await getCardPrompt(db, parsed.data.cardId);
  if (!prompt) return NextResponse.json({ error: "card not found" }, { status: 404 });

  const { recordSpeechAttempt } = await import("@/lib/speech/attempts");

  try {
    const result = await recordSpeechAttempt(db, {
      userId: user.id,
      cardId: parsed.data.cardId,
      studySessionId: parsed.data.sessionId ?? null,
      targetText: prompt.slovene,
      audio: Buffer.from(await file.arrayBuffer()),
      mimeType,
      durationMs: parsed.data.durationMs,
      clientEventId: parsed.data.clientEventId,
      now: parsed.data.recordedAt ? new Date(parsed.data.recordedAt) : undefined,
    });

    return NextResponse.json({
      status: result.status,
      transcript: result.transcript,
      settled: true,
    });
  } catch (error) {
    logger.error({ err: error, clientEventId: parsed.data.clientEventId }, "offline speech upload failed");
    return NextResponse.json({ error: "could not store the recording" }, { status: 500 });
  }
}
