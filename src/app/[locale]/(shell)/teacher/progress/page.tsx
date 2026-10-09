import { Check } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { requireTeacher } from "@/lib/auth";
import { getLearnerProgress } from "@/lib/teacher/progress";
import { cn } from "@/lib/utils";

/**
 * Where she stands right now, for the teacher — distinct from the weekly
 * digest (retrospective, content-planning) and from his own mirrored
 * instance of the learner screens (his data, not hers).
 */
export default async function TeacherProgressPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireTeacher();
  const t = await getTranslations("teacher.progress");
  const progress = await getLearnerProgress(db);

  if (!progress) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pb-10 pt-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        </header>
        <p className="text-muted-foreground">{t("noLearner")}</p>
      </main>
    );
  }

  const stats = [
    { label: t("canSay"), value: progress.summary.canSay },
    {
      label: t("lessonsCompleted"),
      value: t("lessonsProgress", { done: progress.summary.lessonsCompleted, total: progress.totalLessons }),
    },
    { label: t("overdue"), value: progress.cardsOverdue },
  ];

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-8 px-5 pb-10 pt-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle", { name: progress.learnerName })}</p>
      </header>

      <section className="grid grid-cols-3 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{stat.value}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          {progress.daysSinceLastActive === null
            ? t("neverActive")
            : progress.daysSinceLastActive === 0
              ? t("lastToday")
              : t("lastDaysAgo", { days: progress.daysSinceLastActive })}
        </p>
        {progress.hasOpenSession ? (
          <p className="text-sm text-muted-foreground">{t("openSession")}</p>
        ) : null}
        <p className="font-medium">
          {progress.currentLesson ? t("currentLesson", { title: progress.currentLesson.titleDe }) : t("noCurrentLesson")}
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("unitsTitle")}
        </h2>

        {progress.units.map((unit) => (
          <div key={unit.id} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-sm font-semibold tracking-tight">{unit.titleDe}</h3>
              <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {unit.completedCount} / {unit.lessons.length}
              </p>
            </div>

            <ul className="flex flex-col divide-y divide-border border-y border-border">
              {unit.lessons.map((lesson) => (
                <li key={lesson.id} className="flex items-center gap-4 py-3">
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                      lesson.status === "completed"
                        ? "border-primary bg-primary text-primary-foreground"
                        : lesson.status === "in_progress"
                          ? "border-accent text-accent-foreground"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {lesson.status === "completed" ? <Check className="size-3.5" /> : lesson.position}
                  </span>
                  <span className="flex-1 text-sm">{lesson.titleDe}</span>
                  <span className="sr-only">
                    {t(`lessonStatus.${lesson.status}` as "lessonStatus.completed")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </main>
  );
}
