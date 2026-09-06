import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { getCardPrompt, getSettings, startOrResumeSession } from "@/lib/session/service";
import { Button } from "@/components/ui/button";
import { ReviewSession } from "./review-session";

export default async function ReviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser();
  const t = await getTranslations("review");

  const session = await startOrResumeSession(db, user.id);
  const settings = await getSettings(db, user.id);

  if (!session.queue.length) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <p className="text-lg text-muted-foreground">{t("empty")}</p>
        <Button asChild size="lg">
          <Link href="/">{t("emptyAction")}</Link>
        </Button>
      </main>
    );
  }

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
    />
  );
}
