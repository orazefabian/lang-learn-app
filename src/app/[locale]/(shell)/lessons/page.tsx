import { Check, ChevronDown } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { ScrollToNext } from "@/components/scroll-to-next";
import { requireUser } from "@/lib/auth";
import { listUnits, type LessonSummary, type UnitSummary } from "@/lib/lessons/service";
import { cn } from "@/lib/utils";

type Translate = Awaited<ReturnType<typeof getTranslations<"lessons">>>;

/**
 * The lesson list, built around "where am I": the unit she is in is open, the
 * finished ones fold into a single line, the ones ahead are one tap away.
 *
 * Nothing is locked. Order is a suggestion; the warning about skipping lives
 * inside the lesson, not on a locked door.
 */
export default async function LessonsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser();
  const t = await getTranslations("lessons");
  const unitList = await listUnits(db, user.id);

  const isDone = (unit: UnitSummary) =>
    unit.lessons.length > 0 && unit.completedCount === unit.lessons.length;

  // The lesson to continue with: one she has started, else the first not done.
  const allLessons = unitList.flatMap((unit) => unit.lessons);
  const nextId = (
    allLessons.find((lesson) => lesson.status === "in_progress") ??
    allLessons.find((lesson) => lesson.status !== "completed")
  )?.id;

  // Finished units fold into one line; the unit holding the next lesson is open.
  const done = unitList.filter(isDone);
  const unfinished = unitList.filter((unit) => !isDone(unit));

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pb-8 pt-7">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      {unitList.length === 0 ? <p className="text-muted-foreground">{t("empty")}</p> : null}

      {done.length ? (
        <details className="group rounded-2xl bg-primary-soft text-foreground">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <Check className="size-[18px] shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
            <span className="flex-1 font-bold">{t("doneUnits", { count: done.length })}</span>
            <ChevronDown
              className="size-[18px] shrink-0 transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="flex flex-col gap-2 px-2 pb-2">
            {done.map((unit) => (
              <UnitDetails key={unit.id} unit={unit} t={t} />
            ))}
          </div>
        </details>
      ) : null}

      {nextId !== undefined && done.length ? <ScrollToNext targetId="next-lesson" /> : null}

      {unfinished.map((unit) =>
        unit.lessons.some((lesson) => lesson.id === nextId) ? (
          <CurrentUnit key={unit.id} unit={unit} nextId={nextId} t={t} />
        ) : (
          <UnitDetails key={unit.id} unit={unit} t={t} />
        ),
      )}
    </main>
  );
}

function CurrentUnit({
  unit,
  nextId,
  t,
}: {
  unit: UnitSummary;
  nextId: string | undefined;
  t: Translate;
}) {
  return (
    <section
      aria-labelledby={`unit-${unit.id}`}
      className="flex flex-col gap-3.5 rounded-3xl bg-card px-4 pb-2 pt-5"
    >
      <div className="flex flex-col gap-2 px-1">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {t("unitLabel", { position: unit.position })}
          </p>
          <p className="text-sm tabular-nums text-muted-foreground">
            {t("unitProgress", { done: unit.completedCount, total: unit.lessons.length })}
          </p>
        </div>
        <h2 id={`unit-${unit.id}`} className="slovene text-2xl font-semibold">
          {unit.titleDe}
        </h2>
        <div aria-hidden className="flex gap-1">
          {unit.lessons.map((lesson) => (
            <span
              key={lesson.id}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                lesson.status === "completed"
                  ? "bg-primary"
                  : lesson.status === "in_progress"
                    ? "bg-accent"
                    : "bg-secondary",
              )}
            />
          ))}
        </div>
      </div>

      <ol className="flex flex-col">
        {unit.lessons.map((lesson) =>
          lesson.id === nextId ? (
            <li
              key={lesson.id}
              id="next-lesson"
              className="my-1 flex scroll-mt-24 flex-col gap-3 rounded-2xl bg-accent-soft p-3 text-accent-soft-foreground"
            >
              <div className="flex items-center gap-3.5 pl-1">
                <StatusDot status={lesson.status} current />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-lg font-bold leading-snug">{lesson.titleDe}</span>
                  <span className="text-sm">
                    {lesson.status === "in_progress"
                      ? t("inProgressMeta", { minutes: lesson.estimatedMinutes })
                      : t("meta", { minutes: lesson.estimatedMinutes, count: lesson.itemCount })}
                  </span>
                </span>
                <DualBadge lesson={lesson} t={t} />
              </div>
              <Link
                href={`/lessons/${lesson.slug}`}
                className="flex h-12 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {lesson.status === "in_progress" ? t("resume") : t("start")}
                <span className="sr-only">: {lesson.titleDe}</span>
              </Link>
            </li>
          ) : (
            <li key={lesson.id}>
              <LessonRow lesson={lesson} t={t} />
            </li>
          ),
        )}
      </ol>
    </section>
  );
}

function UnitDetails({ unit, t }: { unit: UnitSummary; t: Translate }) {
  return (
    <details className="group rounded-2xl bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm text-muted-foreground">
            {t("unitLabel", { position: unit.position })} ·{" "}
            {t("unitProgress", { done: unit.completedCount, total: unit.lessons.length })}
          </span>
          <span className="slovene text-xl">{unit.titleDe}</span>
        </span>
        <ChevronDown
          className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <ol className="flex flex-col px-3 pb-2">
        {unit.lessons.map((lesson) => (
          <li key={lesson.id}>
            <LessonRow lesson={lesson} t={t} />
          </li>
        ))}
      </ol>
    </details>
  );
}

function LessonRow({ lesson, t }: { lesson: LessonSummary; t: Translate }) {
  return (
    <Link
      href={`/lessons/${lesson.slug}`}
      className="flex min-h-14 items-center gap-3.5 rounded-xl px-1 py-3 transition-colors hover:bg-secondary"
    >
      <StatusDot status={lesson.status} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-bold leading-snug">{lesson.titleDe}</span>
        <span className="text-sm text-muted-foreground">
          {lesson.status === "completed"
            ? `${t("status.completed")} · `
            : lesson.status === "in_progress"
              ? `${t("status.in_progress")} · `
              : ""}
          {t("meta", { minutes: lesson.estimatedMinutes, count: lesson.itemCount })}
        </span>
      </span>
      <DualBadge lesson={lesson} t={t} />
    </Link>
  );
}

function DualBadge({ lesson, t }: { lesson: LessonSummary; t: Translate }) {
  if (!lesson.teachesDual) return null;
  return (
    <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wide text-accent-soft-foreground">
      {t("dualBadge")}
    </span>
  );
}

/** Status in shape as well as colour: filled check, ringed dot, empty ring. */
function StatusDot({ status, current }: { status: LessonSummary["status"]; current?: boolean }) {
  if (status === "completed") {
    return (
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        <Check className="size-4" strokeWidth={3} />
      </span>
    );
  }
  if (current || status === "in_progress") {
    return (
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full border-[3px] border-accent bg-card"
      >
        <span className="size-3 rounded-full bg-accent" />
      </span>
    );
  }
  return <span aria-hidden className="size-8 shrink-0 rounded-full border-2 border-input" />;
}
