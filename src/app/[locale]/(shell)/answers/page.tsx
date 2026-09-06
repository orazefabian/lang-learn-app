import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { listAnswersFor, markAnswersSeen } from "@/lib/questions/service";
import { Button } from "@/components/ui/button";

/**
 * Her answered questions.
 *
 * Opening this page marks them seen — the badge is a nudge, not a task list,
 * and it should disappear once she has looked.
 */
export default async function AnswersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser();
  const t = await getTranslations("home");
  const tAsk = await getTranslations("review.ask");
  const format = await getFormatter();

  const answers = await listAnswersFor(db, user.id);
  // Looking at the page is what clears the nudge.
  await markAnswersSeen(db, user.id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pb-10 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("answeredTitle")}</h1>

      {answers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
          {tAsk("hint")}
        </p>
      ) : (
        <ul className="flex flex-col gap-5">
          {answers.map((answer) => (
            <li
              key={answer.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
            >
              <div className="flex flex-col gap-1">
                <p className="slovene text-xl leading-snug">{answer.item.slovene}</p>
                <p className="text-sm text-muted-foreground">{answer.item.german}</p>
              </div>

              {answer.body ? (
                <p className="border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
                  {answer.body}
                </p>
              ) : null}

              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  {tAsk("answerTitle")}
                </p>
                {answer.answerText ? (
                  <p className="text-sm leading-relaxed">{answer.answerText}</p>
                ) : null}
                {answer.answerAudioPath ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <audio controls preload="none" className="h-9 w-full">
                    <source src={`/api/media/${answer.answerAudioPath}`} />
                  </audio>
                ) : null}
                {answer.answeredAt ? (
                  <p className="text-xs text-muted-foreground">
                    {format.dateTime(answer.answeredAt, { day: "numeric", month: "long" })}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button asChild variant="ghost">
        <Link href="/">{t("canSayAll")}</Link>
      </Button>
    </main>
  );
}
