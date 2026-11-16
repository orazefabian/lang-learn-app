import { ChevronDown } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { getAudioForPhrases } from "@/lib/audio/resolve";
import { getCapabilities, getProgressSummary, getWordsMet } from "@/lib/progress/service";
import { Button } from "@/components/ui/button";
import { PhrasebookList, type PhrasebookEntry } from "./phrasebook-list";

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
  const audio = await getAudioForPhrases(
    db,
    capabilities.map((capability) => capability.phraseId),
  );

  const entries: PhrasebookEntry[] = capabilities.map((capability) => ({
    phraseId: capability.phraseId,
    slovene: capability.slovene,
    german: capability.german,
    contextNote: capability.contextNote,
    isDual: capability.isDual,
    unitTitle: capability.unit?.title ?? null,
    since: format.dateTime(capability.reachedAt, { day: "numeric", month: "long" }),
    audio: audio.get(capability.phraseId) ?? [],
  }));

  // Topic chips in course order, only for units she has phrases from.
  const units = [
    ...new Map(
      capabilities
        .flatMap((capability) => (capability.unit ? [capability.unit] : []))
        .sort((a, b) => a.position - b.position)
        .map((unit) => [unit.title, unit.title]),
    ).values(),
  ];

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-8 pt-7">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>

        {/*
          Counts, not scores. Nothing here is a target, a streak or a
          percentage — they are descriptions of what has accumulated.
        */}
        <dl className="grid grid-cols-3 gap-2.5">
          {[
            { value: summary.canSay, label: t("countLabel") },
            { value: summary.wordsMet, label: t("wordsLabel") },
            { value: summary.lessonsCompleted, label: t("lessonsLabel") },
          ].map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col-reverse gap-1 rounded-2xl bg-card px-3.5 py-3"
            >
              <dt className="text-xs leading-tight text-muted-foreground">{stat.label}</dt>
              <dd className="slovene text-3xl font-semibold tabular-nums leading-none">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      {capabilities.length === 0 ? (
        <div className="flex flex-col items-center gap-5 rounded-2xl border border-dashed border-border px-5 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
          <Button asChild>
            <Link href="/lessons">{t("emptyAction")}</Link>
          </Button>
        </div>
      ) : (
        <PhrasebookList entries={entries} units={units} />
      )}

      {words.length ? (
        <details className="group rounded-2xl bg-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="flex-1 font-bold">{t("wordsTitle")}</span>
            <ChevronDown
              className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <ul className="flex flex-wrap gap-2 px-4 pb-4">
            {words.map((word) => (
              <li
                key={word.id}
                className="rounded-full border border-border px-3 py-1.5 text-sm"
                title={word.german.join(", ")}
              >
                <span lang="sl" className="slovene">
                  {word.slovene}
                </span>
                {word.gender ? (
                  <span className="ml-1.5 text-[0.7rem] uppercase text-muted-foreground">
                    {word.gender}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </main>
  );
}
