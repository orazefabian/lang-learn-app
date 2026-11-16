"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AudioSource } from "@/components/audio-player";
import { PlayButton } from "@/components/play-button";
import { cn } from "@/lib/utils";

export type PhrasebookEntry = {
  phraseId: string;
  slovene: string;
  german: string;
  contextNote: string | null;
  isDual: boolean;
  unitTitle: string | null;
  /** Already formatted on the server, so the client needs no date locale. */
  since: string;
  audio: AudioSource[];
};

type Filter = { kind: "all" } | { kind: "dual" } | { kind: "unit"; title: string };

/** Lower-cased and stripped of carons, so "cas" finds "čas". */
function fold(text: string): string {
  return text
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * The phrasebook list: search and topic chips over what she can say.
 *
 * All of it is already on the page — a couple of hundred short sentences at
 * most — so filtering stays on the phone and works offline.
 */
export function PhrasebookList({ entries, units }: { entries: PhrasebookEntry[]; units: string[] }) {
  const t = useTranslations("progress");
  const tCommon = useTranslations("common");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });

  const hasDual = entries.some((entry) => entry.isDual);

  const visible = useMemo(() => {
    const needle = fold(query.trim());
    return entries.filter((entry) => {
      if (filter.kind === "dual" && !entry.isDual) return false;
      if (filter.kind === "unit" && entry.unitTitle !== filter.title) return false;
      if (!needle) return true;
      return fold(entry.slovene).includes(needle) || fold(entry.german).includes(needle);
    });
  }, [entries, filter, query]);

  const chips: { key: string; label: string; filter: Filter }[] = [
    { key: "all", label: t("filterAll"), filter: { kind: "all" } },
    ...units.map((title) => ({
      key: `unit-${title}`,
      label: title,
      filter: { kind: "unit", title } as Filter,
    })),
    ...(hasDual ? [{ key: "dual", label: t("filterDual"), filter: { kind: "dual" } as Filter }] : []),
  ];

  const isActive = (candidate: Filter) =>
    candidate.kind === filter.kind &&
    (candidate.kind !== "unit" || (filter.kind === "unit" && candidate.title === filter.title));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-12 items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 focus-within:border-ring">
        <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
        <label htmlFor="phrasebook-search" className="sr-only">
          {t("searchLabel")}
        </label>
        <input
          id="phrasebook-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
      </div>

      {chips.length > 1 ? (
        <div
          role="group"
          aria-label={t("filterLabel")}
          className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none]"
        >
          {chips.map((chip) => {
            const active = isActive(chip.filter);
            return (
              <button
                key={chip.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(chip.filter)}
                className={cn(
                  "h-10 shrink-0 whitespace-nowrap rounded-full border px-4 text-[0.95rem] font-bold transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-input bg-card text-foreground hover:bg-secondary",
                )}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
          {t("noMatches")}
        </p>
      ) : (
        /*
         * The phrasebook page. Slovene large in its own face, the German a
         * whisper beneath it, newest at the top so returning shows growth.
         */
        <ul className="flex flex-col gap-2">
          {visible.map((entry) => (
            <li key={entry.phraseId} className="relative rounded-2xl bg-card">
              {/*
                The play button sits beside the row's summary, not inside it, so
                playing never toggles the details open.
              */}
              <div className="absolute right-3 top-3">
                <PlayButton
                  sources={entry.audio}
                  label={tCommon("listen", { phrase: entry.slovene })}
                />
              </div>
              <details className="group">
                <summary className="flex min-h-[68px] cursor-pointer list-none items-center gap-3 py-3 pl-4 pr-16 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span lang="sl" className="slovene text-xl leading-snug">
                        {entry.slovene}
                      </span>
                      {entry.isDual ? (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-accent-soft-foreground">
                          {t("filterDual")}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-sm text-muted-foreground">{entry.german}</span>
                  </span>
                </summary>
                <div className="flex flex-col gap-1.5 border-t border-border px-4 pb-3.5 pt-3">
                  {entry.contextNote ? (
                    <p className="text-sm leading-relaxed">{entry.contextNote}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {entry.unitTitle ? `${entry.unitTitle} · ` : ""}
                    {t("sinceLabel", { date: entry.since })}
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
