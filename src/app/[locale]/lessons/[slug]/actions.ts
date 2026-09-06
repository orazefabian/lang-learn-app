"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { completeLesson, setLessonCursor, startLesson } from "@/lib/lessons/service";

const lessonSchema = z.object({ lessonId: z.string().uuid() });
const cursorSchema = lessonSchema.extend({ cursor: z.number().int().min(0).max(200) });

export async function beginLesson(input: z.input<typeof lessonSchema>): Promise<void> {
  const user = await requireUser();
  const { lessonId } = lessonSchema.parse(input);
  await startLesson(db, user.id, lessonId);
}

/** Keeps the lesson resumable: closing the app mid-lesson loses only the screen. */
export async function saveLessonCursor(input: z.input<typeof cursorSchema>): Promise<void> {
  const user = await requireUser();
  const { lessonId, cursor } = cursorSchema.parse(input);
  await setLessonCursor(db, user.id, lessonId, cursor);
}

export async function finishLesson(
  input: z.input<typeof lessonSchema>,
): Promise<{ cardsCreated: number }> {
  const user = await requireUser();
  const { lessonId } = lessonSchema.parse(input);

  // This is the moment the lesson's items become cards and go to the scheduler.
  const result = await completeLesson(db, user.id, lessonId);

  revalidatePath("/");
  revalidatePath("/lessons");
  revalidatePath("/review");
  return result;
}
