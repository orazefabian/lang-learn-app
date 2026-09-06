import { CalendarRange, FileCheck2, Inbox, Library, Sparkles } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { countPendingProposals } from "@/lib/ai/review";
import { requireTeacher } from "@/lib/auth";
import { isAiConfigured } from "@/lib/env";
import { getInboxCounts } from "@/lib/questions/service";
import { searchContent } from "@/lib/teacher/content";
import { QuickCapture } from "./quick-capture";

export default async function TeacherPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireTeacher();
  const t = await getTranslations("teacher");

  // The working list: what she will hear in a computer voice until someone
  // records it.
  const [missingVoice, inbox, pendingDrafts] = await Promise.all([
    searchContent(db, { status: "active", missingHumanAudio: true, limit: 5 }),
    getInboxCounts(db),
    countPendingProposals(db),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-8 px-5 pb-10 pt-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      {/* The signature feature gets the top of the screen and nothing above it. */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("capture.title")}
        </h2>
        <QuickCapture assistAvailable={isAiConfigured()} />
      </section>

      <section className="flex flex-col gap-3">
        <Link
          href="/teacher/inbox"
          className="flex items-center gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary"
        >
          <Inbox className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex flex-1 flex-col">
            <span className="font-medium">{t("inbox.title")}</span>
            <span className="text-sm text-muted-foreground">
              {t("inbox.badge", { count: inbox.open })}
            </span>
          </span>
          {inbox.open > 0 ? (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold tabular-nums text-accent-foreground">
              {inbox.open}
            </span>
          ) : null}
        </Link>

        <Link
          href="/teacher/content"
          className="flex items-center gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary"
        >
          <Library className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex flex-1 flex-col">
            <span className="font-medium">{t("browser.title")}</span>
            <span className="text-sm text-muted-foreground">{t("browser.searchPlaceholder")}</span>
          </span>
        </Link>

        {pendingDrafts > 0 ? (
          /*
           * Only appears when something is actually waiting. Content she cannot
           * see yet is the one thing on this screen with a queue behind it.
           */
          <Link
            href="/teacher/drafts"
            className="flex items-center gap-4 rounded-lg border border-accent bg-accent-soft/30 p-5 transition-colors hover:border-primary"
          >
            <FileCheck2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex flex-1 flex-col">
              <span className="font-medium">{t("drafts.title")}</span>
              <span className="text-sm text-muted-foreground">{t("drafts.subtitle")}</span>
            </span>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold tabular-nums text-accent-foreground">
              {pendingDrafts}
            </span>
          </Link>
        ) : null}

        <Link
          href="/teacher/digest"
          className="flex items-center gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary"
        >
          <CalendarRange className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex flex-1 flex-col">
            <span className="font-medium">{t("digest.title")}</span>
            <span className="text-sm text-muted-foreground">{t("digest.subtitle")}</span>
          </span>
        </Link>

        {isAiConfigured() ? (
          <Link
            href="/teacher/generate"
            className="flex items-center gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary"
          >
            <Sparkles className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex flex-1 flex-col">
              <span className="font-medium">{t("generate.title")}</span>
              <span className="text-sm text-muted-foreground">{t("generate.subtitle")}</span>
            </span>
          </Link>
        ) : null}

        {missingVoice.length ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-5">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {t("browser.missingVoice")}
            </p>
            <ul className="flex flex-col divide-y divide-border">
              {missingVoice.map((item) => (
                <li key={`${item.kind}-${item.id}`} className="py-2 first:pt-0 last:pb-0">
                  <Link
                    href={`/teacher/items/${item.kind}/${item.id}`}
                    className="flex flex-col gap-0.5 hover:text-primary"
                  >
                    <span className="slovene">{item.slovene}</span>
                    <span className="text-sm text-muted-foreground">{item.german}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </main>
  );
}
