import { Mic, MicOff } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { requireTeacher } from "@/lib/auth";
import { searchContent, type ContentKind, type ContentStatus } from "@/lib/teacher/content";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchParams = {
  q?: string;
  kind?: string;
  status?: string;
  source?: string;
  voice?: string;
};

/**
 * The content browser. Plain GET form rather than a client-side filter panel:
 * the state lives in the URL, so a filtered view can be bookmarked and comes
 * back after an edit.
 */
export default async function ContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireTeacher();
  const query = await searchParams;
  const t = await getTranslations("teacher");

  const rows = await searchContent(db, {
    search: query.q,
    kind: (query.kind as ContentKind | "all") ?? "all",
    status: (query.status as ContentStatus | "all") ?? "all",
    source: (query.source as "seed" | "ai" | "teacher" | "all") ?? "all",
    missingHumanAudio: query.voice === "missing",
    limit: 60,
  });

  const selectClass =
    "min-h-11 rounded-lg border border-input bg-card px-3 text-sm";

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pb-10 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("browser.title")}</h1>

      <form className="flex flex-col gap-3">
        <Input
          type="search"
          name="q"
          defaultValue={query.q ?? ""}
          placeholder={t("browser.searchPlaceholder")}
          aria-label={t("browser.search")}
        />

        <div className="grid grid-cols-3 gap-2">
          <select name="kind" defaultValue={query.kind ?? "all"} className={selectClass} aria-label={t("browser.filterKind")}>
            <option value="all">{t("browser.all")}</option>
            <option value="phrase">{t("browser.phrase")}</option>
            <option value="lexeme">{t("browser.lexeme")}</option>
          </select>

          <select name="status" defaultValue={query.status ?? "all"} className={selectClass} aria-label={t("browser.filterStatus")}>
            <option value="all">{t("browser.all")}</option>
            <option value="active">{t("statusLabel.active")}</option>
            <option value="draft">{t("statusLabel.draft")}</option>
            <option value="archived">{t("statusLabel.archived")}</option>
          </select>

          <select name="source" defaultValue={query.source ?? "all"} className={selectClass} aria-label={t("browser.filterSource")}>
            <option value="all">{t("browser.all")}</option>
            <option value="teacher">{t("sourceLabel.teacher")}</option>
            <option value="seed">{t("sourceLabel.seed")}</option>
            <option value="ai">{t("sourceLabel.ai")}</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            name="voice"
            value="missing"
            defaultChecked={query.voice === "missing"}
            className="size-4"
          />
          {t("browser.missingVoice")}
        </label>

        <button
          type="submit"
          className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          {t("browser.search")}
        </button>
      </form>

      <p className="text-sm text-muted-foreground">{t("browser.results", { count: rows.length })}</p>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
          {t("browser.noResults")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {rows.map((row) => (
            <li key={`${row.kind}-${row.id}`}>
              <Link
                href={`/teacher/items/${row.kind}/${row.id}`}
                className="flex items-start gap-3 py-4 transition-colors hover:text-primary"
              >
                <span className="flex flex-1 flex-col gap-1">
                  <span className="slovene text-lg leading-snug">{row.slovene}</span>
                  <span className="text-sm text-muted-foreground">{row.german || "—"}</span>
                  {row.contextNote ? (
                    <span className="line-clamp-2 border-l-2 border-accent pl-2 text-xs text-muted-foreground">
                      {row.contextNote}
                    </span>
                  ) : null}
                  <span className="flex flex-wrap items-center gap-2 pt-1 text-[0.7rem] text-muted-foreground">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5",
                        row.status === "active"
                          ? "bg-secondary"
                          : row.status === "draft"
                            ? "bg-accent-soft text-accent-foreground"
                            : "bg-muted line-through",
                      )}
                    >
                      {t(`statusLabel.${row.status}` as "statusLabel.active")}
                    </span>
                    <span>{t(`sourceLabel.${row.source}` as "sourceLabel.seed")}</span>
                    {/* Whether a real voice exists is the thing worth seeing at a glance. */}
                    <span className="flex items-center gap-1">
                      {row.humanAudioCount > 0 ? (
                        <>
                          <Mic className="size-3" aria-hidden />
                          {t("browser.hasHumanVoice", { count: row.humanAudioCount })}
                        </>
                      ) : (
                        <>
                          <MicOff className="size-3" aria-hidden />
                          {row.audioCount > 0 ? t("browser.noHumanVoice") : t("browser.noAudio")}
                        </>
                      )}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
