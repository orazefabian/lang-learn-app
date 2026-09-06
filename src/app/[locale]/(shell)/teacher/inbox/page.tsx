import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { requireTeacher } from "@/lib/auth";
import { getInboxCounts, listInbox } from "@/lib/questions/service";
import { cn } from "@/lib/utils";
import { AnswerForm } from "./answer-form";

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireTeacher();
  const { status } = await searchParams;
  const t = await getTranslations("teacher.inbox");
  const format = await getFormatter();

  const filter = status === "answered" || status === "all" ? status : "open";
  const [questions, counts] = await Promise.all([
    listInbox(db, { status: filter }),
    getInboxCounts(db),
  ]);

  const tabs = [
    { key: "open", label: `${t("open")} (${counts.open})` },
    { key: "answered", label: `${t("answered")} (${counts.answered})` },
    { key: "all", label: t("all") },
  ] as const;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pb-10 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      <nav className="flex gap-2" aria-label={t("title")}>
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/teacher/inbox?status=${tab.key}`}
            aria-current={filter === tab.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              filter === tab.key
                ? "border-primary bg-primary/10 font-medium"
                : "border-border text-muted-foreground hover:bg-secondary",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {questions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
          {filter === "answered" ? t("emptyAnswered") : t("emptyOpen")}
        </p>
      ) : (
        <ul className="flex flex-col gap-5">
          {questions.map((question) => (
            <li
              key={question.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
            >
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  {t("askedAbout")}
                </p>
                <p className="slovene text-xl leading-snug">{question.item.slovene}</p>
                <p className="text-sm text-muted-foreground">{question.item.german}</p>
                {question.exerciseType ? (
                  <p className="text-xs text-muted-foreground">{question.exerciseType}</p>
                ) : null}
              </div>

              {/* Her words, or the plain fact that she got stuck here. */}
              <div className="border-l-2 border-accent pl-3">
                <p className={cn("text-sm", !question.body && "italic text-muted-foreground")}>
                  {question.body ?? t("noText")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("asked", {
                    date: format.dateTime(question.createdAt, {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "numeric",
                    }),
                  })}
                </p>
              </div>

              {question.status === "answered" ? (
                <div className="flex flex-col gap-2 rounded-lg bg-secondary px-4 py-3">
                  {question.answerText ? (
                    <p className="text-sm leading-relaxed">{question.answerText}</p>
                  ) : null}
                  {question.answerAudioPath ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <audio controls preload="none" className="h-9 w-full">
                      <source src={`/api/media/${question.answerAudioPath}`} />
                    </audio>
                  ) : null}
                  {question.answeredAt ? (
                    <p className="text-xs text-muted-foreground">
                      {t("answeredOn", {
                        date: format.dateTime(question.answeredAt, {
                          day: "numeric",
                          month: "short",
                        }),
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <AnswerForm questionId={question.id} answered={question.status === "answered"} />

              {question.item.id ? (
                <Link
                  href={`/teacher/items/${question.item.kind}/${question.item.id}`}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  {t("openItem")}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
