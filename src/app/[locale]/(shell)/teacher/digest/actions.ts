"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { requireTeacher } from "@/lib/auth";
import { runWeeklyDigest } from "@/lib/digest/run";
import { updateContentItem } from "@/lib/teacher/content";

/**
 * Acting on the digest.
 *
 * The struggling list is only worth having if something can be done from it
 * without leaving the page, so the two obvious responses — record it properly,
 * say when it is used — are actions here rather than links elsewhere.
 */

export async function rebuildDigest(): Promise<{ ok: true }> {
  await requireTeacher();
  // A rebuild never mails: the week has already been sent if it was going to be.
  await runWeeklyDigest(db, { force: true, email: false });
  revalidatePath("/teacher/digest");
  return { ok: true };
}

const noteSchema = z.object({
  kind: z.enum(["phrase", "lexeme"]),
  id: z.string().uuid(),
  note: z.string().max(2000),
});

export async function saveItemNote(
  input: z.input<typeof noteSchema>,
): Promise<{ ok: true }> {
  await requireTeacher();
  const parsed = noteSchema.parse(input);

  await updateContentItem(db, parsed.kind, parsed.id, {
    contextNote: parsed.note.trim() || null,
  });

  revalidatePath("/teacher/digest");
  revalidatePath(`/teacher/items/${parsed.kind}/${parsed.id}`);
  revalidatePath("/review");
  return { ok: true };
}
