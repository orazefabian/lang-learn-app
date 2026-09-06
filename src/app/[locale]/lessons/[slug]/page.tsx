import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { getLesson } from "@/lib/lessons/service";
import { getSettings } from "@/lib/session/service";
import { LessonPlayer } from "./lesson-player";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const user = await requireUser();
  await getTranslations("lessons");

  const lesson = await getLesson(db, user.id, slug);
  if (!lesson) notFound();

  const settings = await getSettings(db, user.id);

  return <LessonPlayer lesson={lesson} autoplayAudio={settings.autoplayAudio} />;
}
