import { Check } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { listUnits } from "@/lib/lessons/service";
import { cn } from "@/lib/utils";

export default async function LessonsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser();
  const t = await getTranslations("lessons");
  const unitList = await listUnits(db, user.id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-10 px-5 pb-10 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      {unitList.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : null}

      {unitList.map((unit) => (
        <section key={unit.id} className="flex flex-col gap-4">
          <header className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold tracking-tight">{unit.titleDe}</h2>
              <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {t("unitProgress", {
                  done: unit.completedCount,
                  total: unit.lessons.length,
                })}
              </p>
            </div>
            {unit.descriptionDe ? (
              <p className="text-sm text-muted-foreground">{unit.descriptionDe}</p>
            ) : null}
          </header>

          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {unit.lessons.map((lesson) => (
              <li key={lesson.id}>
                {/*
                  Every lesson is openable. Order is a suggestion; the warning
                  about skipping lives inside the lesson, not on a locked door.
                */}
                <Link
                  href={`/lessons/${lesson.slug}`}
                  className="flex items-center gap-4 py-4 transition-colors hover:text-primary"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                      lesson.status === "completed"
                        ? "border-primary bg-primary text-primary-foreground"
                        : lesson.status === "in_progress"
                          ? "border-accent text-accent-foreground"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {lesson.status === "completed" ? (
                      <Check className="size-4" />
                    ) : (
                      lesson.position
                    )}
                  </span>

                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="font-medium leading-snug">{lesson.titleDe}</span>
                    <span className="text-sm text-muted-foreground">
                      {t("meta", {
                        minutes: lesson.estimatedMinutes,
                        count: lesson.itemCount,
                      })}
                    </span>
                  </span>

                  {lesson.teachesDual ? (
                    <span className="dual-mark shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-accent-foreground">
                      {t("dualBadge")}
                    </span>
                  ) : null}

                  {/* Status is stated in words too, never by colour alone. */}
                  <span className="sr-only">{t(`status.${lesson.status}` as "status.completed")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
