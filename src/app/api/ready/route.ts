import { sql as raw } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { isAsrConfigured, isTtsConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Readiness: the database must answer. Piper and Whisper are reported but do
 * not gate readiness — speaking and audio degrade gracefully without them.
 */
export async function GET() {
  try {
    await db.execute(raw`select 1`);
  } catch (error) {
    logger.error({ err: error }, "readiness check failed");
    return NextResponse.json({ status: "unavailable", database: "down" }, { status: 503 });
  }

  return NextResponse.json({
    status: "ok",
    database: "up",
    tts: isTtsConfigured() ? "configured" : "absent",
    asr: isAsrConfigured() ? "configured" : "absent",
  });
}
