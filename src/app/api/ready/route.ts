import { sql as raw } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { getAsrClient } from "@/lib/speech/asr";
import { getTtsClient } from "@/lib/audio/tts";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

type ServiceState = "reachable" | "unreachable" | "absent";

async function probe(
  configured: boolean,
  check: () => Promise<boolean>,
): Promise<ServiceState> {
  if (!configured) return "absent";
  try {
    return (await check()) ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

/**
 * Readiness: the database must answer.
 *
 * Piper and Whisper are probed and reported but never gate readiness — without
 * TTS there is no generated audio, and without ASR speaking exercises fall back
 * to self-assessment. Both are degradations, not outages, and a deployment
 * should not be marked unhealthy for them. The distinction between "absent"
 * (not configured) and "unreachable" (configured but not answering) is the
 * whole point: the second one is a problem worth looking at.
 */
export async function GET() {
  try {
    await db.execute(raw`select 1`);
  } catch (error) {
    logger.error({ err: error }, "readiness check failed");
    return NextResponse.json({ status: "unavailable", database: "down" }, { status: 503 });
  }

  const tts = getTtsClient();
  const asr = getAsrClient();

  const [ttsState, asrState] = await Promise.all([
    probe(tts.engine !== "none", () => tts.isAvailable()),
    probe(asr.engine !== "none", () => asr.isAvailable()),
  ]);

  return NextResponse.json({
    status: "ok",
    database: "up",
    tts: { engine: tts.engine, state: ttsState },
    asr: { engine: asr.engine, state: asrState },
  });
}
