"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { setAutoplayAudio } from "@/lib/session/service";

/** Persists whether audio plays by itself. Sticky: it is a preference, not a per-session mood. */
export async function updateAutoplay(value: boolean): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const parsed = z.boolean().safeParse(value);
  if (!parsed.success) return { ok: false };

  await setAutoplayAudio(db, user.id, parsed.data);
  revalidatePath("/", "layout");
  return { ok: true };
}
