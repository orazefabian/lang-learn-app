import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { requireTeacher } from "@/lib/auth";
import { countMissingRecordings, getRecordingQueue } from "@/lib/teacher/recordings";
import { RecordQueue } from "./record-queue";

/**
 * The recording session.
 *
 * Recording one item at a time through the content browser means a page load
 * per phrase, which is why a few hundred of them never get a voice. This is the
 * same job without the navigation: read, record, keep, next.
 */
export default async function RecordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireTeacher();
  const t = await getTranslations("teacher.record");

  const [queue, missing] = await Promise.all([
    getRecordingQueue(db, { limit: 25 }),
    countMissingRecordings(db),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pb-10 pt-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      <RecordQueue initialQueue={queue} remaining={missing.total} />
    </main>
  );
}
