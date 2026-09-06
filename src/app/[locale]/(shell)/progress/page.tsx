import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { getCapabilities, getProgressSummary, getWordsMet } from "@/lib/progress/service";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function ProgressPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser();
  const t = await getTranslations("progress");
  const format = await getFormatter();

  const [summary, capabilities, words] = await Promise.all([
    getProgressSummary(db, user.id),
    getCapabilities(db, user.id),
    getWordsMet(db, user.id, 60),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-8 px-5 pb-10 pt-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </header>

      {/*
        Counts, not scores. Nothing here is a target, a streak or a percentage —
        they are descriptions of what has accumulated.
      */}
      <dl className="grid grid-cols-3 gap-3">
        {[
          { value: summary.canSay, label: t("countLabel") },
          { value: summary.wordsMet, label: t("wordsLabel") },
          { value: summary.lessonsCompleted, label: t("lessonsLabel") },
        ].map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-4"
          >
            <dt className="sr-only">{stat.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums leading-none">{stat.value}</dd>
            <p aria-hidden className="text-[0.7rem] leading-tight text-muted-foreground">
              {stat.label}
            </p>
          </div>
        ))}
      </dl>

      {summary.dualMastered > 0 ? (
        <p className="dual-mark text-sm text-muted-foreground">
          {summary.dualMastered} {t("dualLabel")}
        </p>
      ) : null}

      {capabilities.length === 0 ? (
        <div className="flex flex-col items-center gap-5 rounded-lg border border-dashed border-border px-5 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
          <Button asChild>
            <Link href="/lessons">{t("emptyAction")}</Link>
          </Button>
        </div>
      ) : (
        /*
         * The phrasebook page. Slovene large in its own face, the German a
         * whisper beneath it, newest at the top so returning shows growth.
         */
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {capabilities.map((capability) => (
            <li key={capability.phraseId} className="flex flex-col gap-1.5 py-5">
              <p
                className={cn("slovene text-2xl leading-snug", capability.isDual && "dual-mark")}
              >
                {capability.slovene}
              </p>
              <p className="text-sm text-muted-foreground">{capability.german}</p>
              {capability.contextNote ? (
                <p className="mt-1 border-l-2 border-accent pl-3 text-sm text-muted-foreground">
                  {capability.contextNote}
                </p>
              ) : null}
              <p className="text-[0.7rem] text-muted-foreground/70">
                {t("sinceLabel", {
                  date: format.dateTime(capability.reachedAt, {
                    day: "numeric",
                    month: "long",
                  }),
                })}
              </p>
            </li>
          ))}
        </ul>
      )}

      {words.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("wordsTitle")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {words.map((word) => (
              <li
                key={word.id}
                className="rounded-full border border-border px-3 py-1.5 text-sm"
                title={word.german.join(", ")}
              >
                <span className="slovene">{word.slovene}</span>
                {word.gender ? (
                  <span className="ml-1.5 text-[0.7rem] uppercase text-muted-foreground">
                    {word.gender}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
