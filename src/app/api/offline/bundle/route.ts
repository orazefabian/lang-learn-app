import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { currentUser } from "@/lib/auth";
import { buildOfflineBundle } from "@/lib/offline/bundle";

export const dynamic = "force-dynamic";

/**
 * The next session, in one response, for the browser to keep.
 *
 * Never cached by the service worker itself: a stale bundle would hand her
 * cards she has already answered. The client stores it in IndexedDB and
 * decides for itself when it is too old.
 */
export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const bundle = await buildOfflineBundle(db, user.id);
  if (!bundle) {
    return NextResponse.json(
      { bundle: null, reason: "nothing-due" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json({ bundle }, { headers: { "Cache-Control": "no-store" } });
}
