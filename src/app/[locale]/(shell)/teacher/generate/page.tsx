import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { listRuns } from "@/lib/ai/review";
import { requireTeacher } from "@/lib/auth";
import { isAiConfigured } from "@/lib/env";
import { GenerateForm } from "./generate-form";

export default async function GeneratePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireTeacher();
  const t = await getTranslations("teacher.generate");
  const format = await getTranslations("common");

  const runs = await listRuns(db, 10);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-8 px-5 pb-10 pt-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
        {/* Said once, at the top, because it is the whole contract. */}
        <p className="mt-2 border-l-2 border-accent pl-3 text-sm text-muted-foreground">
          {t("gate")}
        </p>
      </header>

      {isAiConfigured() ? (
        <GenerateForm />
      ) : (
        <p className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
          {t("notConfigured")}
        </p>
      )}

      {runs.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("recentRuns")}
          </h2>
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {runs.map((run) => (
              <li key={run.id} className="py-3">
                <Link
                  href={`/teacher/drafts?run=${run.id}`}
                  className="flex items-baseline justify-between gap-3 hover:text-primary"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{run.topic}</span>
                    <span className="text-sm text-muted-foreground">
                      {run.status === "failed"
                        ? t("runFailed")
                        : t("runSummary", {
                            drafted: run.draftedCount,
                            duplicates: run.duplicateCount,
                          })}
                    </span>
                  </span>
                  {run.pendingCount > 0 ? (
                    <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold tabular-nums text-accent-foreground">
                      {run.pendingCount}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {format("done")}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
