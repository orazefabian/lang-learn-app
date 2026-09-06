import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { listProposals, listRuns } from "@/lib/ai/review";
import { requireTeacher } from "@/lib/auth";
import { DraftList } from "./draft-list";

/**
 * The gate she never sees.
 *
 * Everything on this screen is a draft: it exists in the database, it has no
 * cards, and it is invisible to the learner until someone here presses
 * approve. That is the whole point of the screen.
 */
export default async function DraftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireTeacher();
  const t = await getTranslations("teacher.drafts");

  const { run: runId } = await searchParams;
  const [proposals, runs] = await Promise.all([
    listProposals(db, { ...(runId ? { runId } : {}), decision: "pending" }),
    listRuns(db, 20),
  ]);

  const activeRun = runId ? runs.find((run) => run.id === runId) : undefined;
  const totalPending = runs.reduce((sum, run) => sum + run.pendingCount, 0);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-8 px-5 pb-10 pt-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      {activeRun ? (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("runTopic")}
          </p>
          <p className="font-medium">{activeRun.topic}</p>
          {activeRun.modelNotes ? (
            <p className="border-l-2 border-accent pl-3 text-sm text-muted-foreground">
              {activeRun.modelNotes}
            </p>
          ) : null}
          {runId && totalPending > proposals.length ? (
            <Link href="/teacher/drafts" className="text-sm text-primary hover:underline">
              {t("showAll", { count: totalPending })}
            </Link>
          ) : null}
        </section>
      ) : null}

      {proposals.length ? (
        <DraftList proposals={proposals} runId={runId ?? activeRun?.id ?? null} />
      ) : (
        <div className="flex flex-col gap-4 rounded-lg border border-dashed border-border px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
          <Link href="/teacher/generate" className="text-sm text-primary hover:underline">
            {t("generateMore")}
          </Link>
        </div>
      )}
    </main>
  );
}
