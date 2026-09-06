import { ArrowRight, MessageCircle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { currentUser } from "@/lib/auth";
import { getNextLesson } from "@/lib/lessons/service";
import { getCapabilities, getProgressSummary } from "@/lib/progress/service";
import { getUnseenAnswers } from "@/lib/questions/service";
import { getSessionOverview } from "@/lib/session/service";
import { OfflineReady } from "@/components/offline-ready";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await currentUser();
  if (!user) redirect("/login");

  const t = await getTranslations("home");

  const [overview, nextLesson, summary, capabilities, answers] = await Promise.all([
    getSessionOverview(db, user.id),
    getNextLesson(db, user.id),
    getProgressSummary(db, user.id),
    getCapabilities(db, user.id, 3),
    getUnseenAnswers(db, user.id),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-8 px-5 pb-10 pt-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("greeting", { name: user.displayName })}
        </h1>
        {/* Never "you were away for 12 days". */}
        <p className="text-muted-foreground">{t("welcomeBack")}</p>
      </header>

      {/*
        Something she asked about has come back. This is the one notification
        the app has, and it only ever carries good news.
      */}
      {answers.length ? (
        <section className="flex flex-col gap-3 rounded-lg border border-accent bg-accent-soft/30 p-5">
          <p className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <MessageCircle className="size-4" aria-hidden />
            {t("answeredTitle")}
          </p>
          <p className="text-sm">{t("answeredCount", { count: answers.length })}</p>
          <ul className="flex flex-col gap-3">
            {answers.slice(0, 2).map((answer) => (
              <li key={answer.id} className="flex flex-col gap-1">
                <p className="slovene text-lg leading-snug">{answer.item.slovene}</p>
                {answer.answerText ? (
                  <p className="text-sm text-muted-foreground">{answer.answerText}</p>
                ) : null}
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" size="sm" block>
            <Link href="/answers">{t("answeredOpen")}</Link>
          </Button>
        </section>
      ) : null}

      {/*
        Two ways in, always both available: reviews never depend on lessons and
        lessons never depend on reviews.
      */}
      <section className="flex flex-col gap-3">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("dueToday")}
          </p>
          <p
            className={cn(
              "mt-1 tracking-tight",
              overview.displayedDue > 0
                ? "text-3xl font-semibold tabular-nums"
                : "text-xl text-muted-foreground",
            )}
          >
            {/*
              The capped number and nothing else. The real backlog exists in the
              database for the weekly digest; it never reaches this screen.
            */}
            {overview.displayedDue > 0 ? t("dueTodayCount", { count: overview.displayedDue }) : t("nothingDue")}
          </p>
          {overview.hasMoreThanShown ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("moreLater")}</p>
          ) : null}
          {overview.displayedDue === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("nothingDueHint")}</p>
          ) : null}

          <Button asChild size="lg" block className="mt-4">
            <Link href="/review">{t("reviewCta")}</Link>
          </Button>

          {/* Answers "will this work on the train" before she is on the train. */}
          <div className="mt-3">
            <OfflineReady />
          </div>
        </div>

        {nextLesson ? (
          <Link
            href={`/lessons/${nextLesson.slug}`}
            className="group flex items-center gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary"
          >
            <div className="flex flex-1 flex-col gap-1">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {t("continueLesson")}
              </p>
              <p className="text-lg font-semibold tracking-tight">{nextLesson.titleDe}</p>
              <p className="text-sm text-muted-foreground">
                {t("lessonMeta", {
                  minutes: nextLesson.estimatedMinutes,
                  count: nextLesson.itemCount,
                })}
              </p>
            </div>
            <ArrowRight
              className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        ) : (
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-muted-foreground">{t("allLessonsDone")}</p>
            <Button asChild variant="outline" block className="mt-4">
              <Link href="/lessons">{t("browseLessons")}</Link>
            </Button>
          </div>
        )}
      </section>

      {/*
        The signature of the whole app: progress as accumulated speech. A
        phrasebook page filling up, never a streak or a percentage.
      */}
      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("canSayTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("canSayCount", { count: summary.canSay })}
          </p>
        </div>

        {capabilities.length ? (
          <>
            <ul className="flex flex-col divide-y divide-border border-y border-border">
              {capabilities.map((capability) => (
                <li key={capability.phraseId} className="flex flex-col gap-1 py-4">
                  <p
                    className={cn(
                      "slovene text-xl leading-snug",
                      capability.isDual && "dual-mark",
                    )}
                  >
                    {capability.slovene}
                  </p>
                  <p className="text-sm text-muted-foreground">{capability.german}</p>
                </li>
              ))}
            </ul>
            <Link
              href="/progress"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("canSayAll")}
            </Link>
          </>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
            {t("canSayEmpty")}
          </p>
        )}
      </section>
    </main>
  );
}
