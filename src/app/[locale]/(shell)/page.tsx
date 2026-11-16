import { ArrowRight, ChevronRight, MessageCircle, Route } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { currentUser } from "@/lib/auth";
import { getAudioForPhrases } from "@/lib/audio/resolve";
import { getNextLesson } from "@/lib/lessons/service";
import { getCapabilities, getProgressSummary } from "@/lib/progress/service";
import { getUnseenAnswers } from "@/lib/questions/service";
import { getSessionOverview } from "@/lib/session/service";
import { LanguageSwitcher } from "@/components/language-switcher";
import { OfflineReady } from "@/components/offline-ready";
import { PlayButton } from "@/components/play-button";
import { cn } from "@/lib/utils";

/** A rough pace for the "etwa N Min" hint: half a minute a card. */
const SECONDS_PER_CARD = 30;

/**
 * Heute.
 *
 * Laid out for one thumb: the things to read sit at the top, the things to tap
 * sit at the bottom, right above the tab bar. Before, the main button was in
 * the middle of a stack of cards and the phrasebook pushed it off-screen.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await currentUser();
  if (!user) redirect("/login");

  const t = await getTranslations("home");
  const tCommon = await getTranslations("common");
  const format = await getFormatter();

  const [overview, nextLesson, summary, capabilities, answers] = await Promise.all([
    getSessionOverview(db, user.id),
    getNextLesson(db, user.id),
    getProgressSummary(db, user.id),
    getCapabilities(db, user.id, 2),
    getUnseenAnswers(db, user.id),
  ]);
  const audio = await getAudioForPhrases(
    db,
    capabilities.map((capability) => capability.phraseId),
  );

  /*
   * Everything above the two actions has to fit one phone screen, or "Weiter
   * lernen" slides under the tab bar. On a day with an answer waiting, one
   * newest phrase is enough; the Satzbuch has the rest.
   */
  const newest = capabilities.slice(0, answers.length ? 1 : 2);

  const minutes = Math.max(1, Math.round((overview.displayedDue * SECONDS_PER_CARD) / 60));
  const firstAnswer = answers[0];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-5 pb-4 pt-5">
      <header className="flex flex-col gap-1.5">
        <div className="flex min-h-7 items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {format.dateTime(new Date(), { weekday: "long", day: "numeric", month: "long" })}
          </p>
          {/* Answers "will this work on the train" before she is on the train. */}
          <OfflineReady />
        </div>
        <h1 lang="sl" className="slovene text-[2rem] font-semibold leading-tight">
          {t("greeting", { name: user.displayName })}
        </h1>
        {/* Never "you were away for 12 days". */}
        <p className="text-muted-foreground">{t("welcomeBack")}</p>
      </header>

      {/*
        Something she asked about has come back. This is the one notification
        the app has, and it only ever carries good news.
      */}
      {firstAnswer ? (
        <Link
          href="/answers"
          className="flex items-center gap-3.5 rounded-2xl bg-accent-soft px-4 py-3.5 text-accent-soft-foreground"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <MessageCircle className="size-5" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-bold">
              {t("answeredCount", { count: answers.length })}
            </span>
            <span className="slovene truncate text-lg">{firstAnswer.item.slovene}</span>
          </span>
          <ChevronRight className="size-5 shrink-0" aria-hidden />
        </Link>
      ) : null}

      {/*
        The signature of the whole app: progress as accumulated speech. Only the
        newest two here — the full phrasebook is its own tab.
      */}
      {capabilities.length ? (
        <section className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
              {t("canSayTitle")}
            </h2>
            <Link
              href="/progress"
              className="py-2.5 text-sm font-bold text-primary underline-offset-4 hover:underline"
            >
              {t("canSayAll", { count: summary.canSay })}
            </Link>
          </div>
          <ul className="flex flex-col divide-y divide-border rounded-2xl bg-card">
            {newest.map((capability) => (
              <li key={capability.phraseId} className="flex items-center gap-3 py-3 pl-4 pr-3">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    lang="sl"
                    className={cn(
                      "slovene text-xl leading-snug",
                      capability.isDual && "dual-mark",
                    )}
                  >
                    {capability.slovene}
                  </span>
                  <span className="text-sm text-muted-foreground">{capability.german}</span>
                </span>
                <PlayButton
                  sources={audio.get(capability.phraseId) ?? []}
                  label={tCommon("listen", { phrase: capability.slovene })}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-5 py-6 text-center text-sm text-muted-foreground">
          {t("canSayEmpty")}
        </p>
      )}

      <div className="flex-1" />

      {/*
        Two ways in, always both available: reviews never depend on lessons and
        lessons never depend on reviews. Both sit where the thumb already is.
      */}
      <section className="flex flex-col gap-2.5" aria-label={t("dueToday")}>
        <div className="flex flex-col gap-4 rounded-3xl bg-card p-5 shadow-lg shadow-foreground/5">
          <div className="flex items-end justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {t("dueToday")}
              </p>
              {/*
                The capped number and nothing else. The real backlog exists in
                the database for the weekly digest; it never reaches this screen.
              */}
              <p
                className={cn(
                  "tracking-tight",
                  overview.displayedDue > 0
                    ? "text-3xl font-bold tabular-nums"
                    : "text-xl text-muted-foreground",
                )}
              >
                {overview.displayedDue > 0
                  ? t("dueTodayCount", { count: overview.displayedDue })
                  : t("nothingDue")}
              </p>
            </div>
            {overview.displayedDue > 0 ? (
              <p className="mb-1.5 text-muted-foreground">{t("dueMinutes", { minutes })}</p>
            ) : null}
          </div>

          {overview.hasMoreThanShown ? (
            <p className="-mt-2 text-sm text-muted-foreground">{t("moreLater")}</p>
          ) : null}
          {overview.displayedDue === 0 ? (
            <p className="-mt-2 text-sm text-muted-foreground">{t("nothingDueHint")}</p>
          ) : null}

          {/* With nothing due, the lesson below is the suggested step instead. */}
          <Link
            href="/review"
            className={cn(
              "flex h-14 items-center justify-center gap-2.5 rounded-2xl text-lg font-bold transition-colors",
              overview.displayedDue > 0
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "border border-input bg-card text-foreground hover:bg-secondary",
            )}
          >
            {t("reviewCta")}
            <ArrowRight className="size-5" aria-hidden />
          </Link>
        </div>

        {nextLesson ? (
          <Link
            href={`/lessons/${nextLesson.slug}`}
            className={cn(
              "flex items-center gap-3.5 rounded-2xl bg-card px-4 py-3.5 transition-colors hover:bg-secondary",
              // With nothing due, learning something new is the suggested next step.
              overview.displayedDue === 0 && "ring-2 ring-primary",
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
              <Route className="size-5" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm text-muted-foreground">
                {t("continueLesson")} ·{" "}
                {t("lessonMeta", {
                  minutes: nextLesson.estimatedMinutes,
                  count: nextLesson.itemCount,
                })}
              </span>
              <span className="truncate text-lg font-bold">{nextLesson.titleDe}</span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        ) : (
          <Link
            href="/lessons"
            className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-4 text-muted-foreground"
          >
            {t("allLessonsDone")}
            <ChevronRight className="size-5 shrink-0" aria-hidden />
          </Link>
        )}
      </section>

      <div className="flex justify-center pt-1">
        <LanguageSwitcher />
      </div>
    </main>
  );
}
