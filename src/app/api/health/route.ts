import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness: the process is up. Deliberately touches nothing else. */
export function GET() {
  return NextResponse.json({ status: "ok", service: "app", time: new Date().toISOString() });
}
