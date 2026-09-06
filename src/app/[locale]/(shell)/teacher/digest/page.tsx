import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { requireTeacher } from "@/lib/auth";
import { getSnapshot, listSnapshots } from "@/lib/digest/service";
import { StrugglingList } from "./struggling-list";
import { RebuildButton } from "./rebuild-button";

/**
 * The week, for the teacher.
 *
 * Numbers first because they are quick to read, then the part that is actually
 * the point: what is not sticking, with something he can do about it right
 * here. Nothing on this page characterises how much she studied.
 */
export default async function DigestPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireTeacher();
  const t = await getTranslations("teacher.digest");

  const { week } = await searchParams;
  const snapshots = await listSnapshots(db, 12);
  // A week that no longer exists falls back to the newest one rather than to
  // the "nothing here yet" screen, which would be a lie about the data.
  const requested = week ? await getSnapshot(db, week) : null;
  const current = requested ?? snapshots[0] ?? null;

  const dateRange = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "long" });
  const percent = (rate: number | null) =>
    rate === null ? "—" : `${Math.round(rate * 100)} %`;

  if (!current) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pb-10 pt-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </header>
        <div className="flex flex-col gap-4 rounded-lg border border-dashed border-border px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
          <RebuildButton label={t("buildNow")} pendingLabel={t("building")} />
        </div>
      </main>
    );
  }

  const { data } = current;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-8 px-5 pb-10 pt-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("range", {
            start: dateRange.format(new Date(data.period.start)),
            end: dateRange.format(new Date(data.period.end)),
            name: current.subjectName,
          })}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3">
        {[
          { label: t("reviews"), value: data.reviewed.total },
          { label: t("cards"), value: data.reviewed.distinctCards },
          { label: t("retention"), value: percent(data.retention.rate) },
          { label: t("newStarted"), value: data.learned.newCardsStarted },
          { label: t("lessons"), value: data.learned.lessonsCompleted },
          { label: t("canSay"), value: data.learned.canSayTotal },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
              {stat.value}
            </p>
          </div>
        ))}
      </section>

      {/* Stated, not judged. */}
      <p className="text-sm text-muted-foreground">
        {data.daysSinceLastSession === null
          ? t("neverStudied")
          : data.daysSinceLastSession === 0
            ? t("lastToday")
            : t("lastDaysAgo", { days: data.daysSinceLastSession })}
        {data.retention.mature > 0 ? ` ${t("retentionBasis", { count: data.retention.mature })}` : ""}
      </p>

      {data.struggling.length ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {t("strugglingTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("strugglingHint")}</p>
          </div>
          <StrugglingList items={data.struggling} />
        </section>
      ) : null}

      {data.speech.lowest.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("speechTitle")}
          </h2>
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {data.speech.lowest.map((attempt) => (
              <li key={attempt.id} className="flex flex-col gap-1 py-3">
                <p className="slovene text-lg leading-snug">{attempt.targetText}</p>
                <p className="text-sm text-muted-foreground">
                  {attempt.transcript
                    ? t("heardAs", { transcript: attempt.transcript })
                    : t("heardNothing")}
                </p>
              </li>
            ))}
          </ul>
          {/* The scorer is a word-recognition aid, and the page says so. */}
          <p className="text-xs text-muted-foreground">{t("speechCaveat")}</p>
        </section>
      ) : null}

      {data.openQuestions.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("questionsTitle")}
          </h2>
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {data.openQuestions.map((question) => (
              <li key={question.id} className="flex flex-col gap-1 py-3">
                <p className="slovene">{question.slovene}</p>
                {question.body ? <p className="text-sm">{question.body}</p> : null}
                <p className="text-xs text-muted-foreground">
                  {question.ageDays === 0
                    ? t("askedToday")
                    : t("askedDaysAgo", { days: question.ageDays })}
                </p>
              </li>
            ))}
          </ul>
          <Link
            href="/teacher/inbox"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("toInbox")}
          </Link>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("weeksTitle")}
        </h2>
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id} className="py-2">
              <Link
                href={`/teacher/digest?week=${snapshot.id}`}
                className={
                  snapshot.id === current.id
                    ? "font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }
              >
                {dateRange.format(snapshot.periodStart)} – {dateRange.format(snapshot.periodEnd)}
              </Link>
            </li>
          ))}
        </ul>
        <RebuildButton label={t("rebuild")} pendingLabel={t("building")} />
      </section>
    </main>
  );
}
