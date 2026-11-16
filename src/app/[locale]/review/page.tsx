import { setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth";
import { getNextLesson } from "@/lib/lessons/service";
import { getCardPrompt, getSettings, startOrResumeSession } from "@/lib/session/service";
import { ReviewSession } from "./review-session";

export default async function ReviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser();

  const session = await startOrResumeSession(db, user.id);
  const [settings, nextLesson] = await Promise.all([
    getSettings(db, user.id),
    getNextLesson(db, user.id),
  ]);

  /*
   * Nothing due still renders the session component, which shows the empty
   * state itself. Grading revalidates, which re-renders this page; if the
   * empty state were a different tree here, the done screen would be swapped
   * out for "nothing due" the moment she finished her last card.
   */
  // Only the current card is sent to the client; the rest of the queue stays
  // on the server so a closed tab never loses its place.
  const cardId = session.queue[session.cursor];
  const prompt = cardId ? await getCardPrompt(db, cardId) : null;

  return (
    <ReviewSession
      sessionId={session.sessionId}
      initialCard={prompt}
      cursor={session.cursor}
      total={session.queue.length}
      autoplayAudio={settings.autoplayAudio}
      nextLesson={
        nextLesson
          ? {
              slug: nextLesson.slug,
              title: nextLesson.titleDe,
              minutes: nextLesson.estimatedMinutes,
            }
          : null
      }
    />
  );
}
