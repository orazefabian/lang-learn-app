"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { AudioPlayer } from "@/components/audio-player";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useRouter } from "@/i18n/navigation";
import { compareAnswer } from "@/lib/answers/compare";
import type { LessonView } from "@/lib/lessons/service";
import { cn } from "@/lib/utils";
import { beginLesson, finishLesson, saveLessonCursor } from "./actions";

/**
 * The lesson: a short guided sequence, one thing on screen at a time.
 *
 * Presentation first — the item, its audio, when you would say it — then one
 * low-stakes try. Nothing here is graded. Finishing is what hands the items to
 * the scheduler; until then she can leave without consequence.
 */
type Step =
  | { kind: "intro" }
  | { kind: "item"; index: number }
  | { kind: "practice"; index: number }
  | { kind: "done" };

export function LessonPlayer({
  lesson,
  autoplayAudio,
}: {
  lesson: LessonView;
  autoplayAudio: boolean;
}) {
  const t = useTranslations("lessons");
  const router = useRouter();

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [{ kind: "intro" }];
    lesson.items.forEach((item, index) => {
      list.push({ kind: "item", index });
      if (item.practice) list.push({ kind: "practice", index });
    });
    list.push({ kind: "done" });
    return list;
  }, [lesson.items]);

  const [acknowledgedSkip, setAcknowledgedSkip] = useState(lesson.skippedLessons.length === 0);
  const [position, setPosition] = useState(() => Math.min(lesson.cursor, steps.length - 1));
  const [cardsCreated, setCardsCreated] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const step = steps[position] as Step;

  useEffect(() => {
    void beginLesson({ lessonId: lesson.id });
  }, [lesson.id]);

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(next, steps.length - 1));
      setPosition(clamped);
      void saveLessonCursor({ lessonId: lesson.id, cursor: clamped });
    },
    [lesson.id, steps.length],
  );

  const complete = useCallback(() => {
    startTransition(async () => {
      const result = await finishLesson({ lessonId: lesson.id });
      setCardsCreated(result.cardsCreated);
      go(steps.length - 1);
    });
  }, [go, lesson.id, steps.length]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowRight") go(position + 1);
      if (event.key === "ArrowLeft") go(position - 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, position]);

  /*
   * Skipping ahead is allowed — the brief is explicit that lessons are ordered
   * but not gated. It just says so once, warmly, before she starts.
   */
  if (!acknowledgedSkip) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
        <h1 className="text-xl font-semibold tracking-tight">{t("skipWarningTitle")}</h1>
        <p className="text-muted-foreground">
          {t("skipWarningBody", { count: lesson.skippedLessons.length })}
        </p>
        <div className="flex flex-col gap-3">
          <Button size="lg" block onClick={() => setAcknowledgedSkip(true)}>
            {t("skipWarningContinue")}
          </Button>
          <Button asChild variant="ghost" block>
            <Link href="/lessons">{t("skipWarningBack")}</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-4">
      <header className="flex items-center gap-3">
        <Link
          href="/lessons"
          aria-label={t("back")}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-5" />
        </Link>
        <div aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${(position / (steps.length - 1)) * 100}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {position + 1}/{steps.length}
        </span>
      </header>

      <div className="flex flex-1 flex-col justify-center py-8">
        {step.kind === "intro" ? (
          <IntroStep lesson={lesson} labels={{ intro: t("intro"), goal: t("goal"), grammar: t("grammarNote") }} />
        ) : null}

        {step.kind === "item" ? (
          <ItemStep
            item={lesson.items[step.index] as LessonView["items"][number]}
            autoplayAudio={autoplayAudio}
            label={t("newItems")}
          />
        ) : null}

        {step.kind === "practice" ? (
          <PracticeStep
            key={step.index}
            item={lesson.items[step.index] as LessonView["items"][number]}
            labels={{
              title: t("practice"),
              hint: t("practiceHint"),
              check: t("checkPractice"),
              correct: t("practiceCorrect"),
              wrong: t("practiceWrong"),
            }}
          />
        ) : null}

        {step.kind === "done" ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">{t("finished.title")}</h2>
            <p className="text-muted-foreground">
              {t("finished.body", { count: cardsCreated ?? lesson.items.length })}
            </p>
          </div>
        ) : null}
      </div>

      <footer className="flex flex-col gap-3">
        {step.kind === "done" ? (
          <>
            <Button asChild size="lg" block>
              <Link href="/review">{t("finished.review")}</Link>
            </Button>
            <Button variant="ghost" block onClick={() => router.push("/lessons")}>
              {t("finished.next")}
            </Button>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => go(position - 1)}
              disabled={position === 0}
              aria-label={t("back")}
            >
              <ArrowLeft />
            </Button>

            {position === steps.length - 2 ? (
              <Button size="lg" className="flex-1" onClick={complete} disabled={pending}>
                {t("finish")}
              </Button>
            ) : (
              <Button size="lg" className="flex-1" onClick={() => go(position + 1)}>
                {t("next")}
                <ArrowRight />
              </Button>
            )}
          </div>
        )}
      </footer>
    </main>
  );
}

function IntroStep({
  lesson,
  labels,
}: {
  lesson: LessonView;
  labels: { intro: string; goal: string; grammar: string };
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {lesson.unit ? (
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {lesson.unit.titleDe}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight">{lesson.titleDe}</h1>
      </div>

      {lesson.goalDe ? (
        <div className="rounded-lg border-l-2 border-accent bg-accent-soft/40 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {labels.goal}
          </p>
          <p className="mt-1 leading-relaxed">{lesson.goalDe}</p>
        </div>
      ) : null}

      {lesson.introDe ? <SimpleMarkdown content={lesson.introDe} /> : null}

      {lesson.grammarNotes.map((note) => (
        <details
          key={note.slug}
          className="rounded-lg border border-border bg-card px-4 py-3"
        >
          {/* Grammar is always available and never blocks practice. */}
          <summary className="cursor-pointer list-none text-sm font-medium">
            <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {labels.grammar}
            </span>
            <span className="mt-1 block">{note.titleDe}</span>
          </summary>
          <SimpleMarkdown content={note.bodyDe} className="mt-3 text-sm" />
        </details>
      ))}
    </div>
  );
}

function ItemStep({
  item,
  autoplayAudio,
  label,
}: {
  item: LessonView["items"][number];
  autoplayAudio: boolean;
  label: string;
}) {
  const t = useTranslations("review");

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>

      <p className="slovene text-balance text-4xl leading-tight">{item.slovene}</p>
      <p className="text-lg text-muted-foreground">{item.german}</p>

      {item.register !== "standard" ? (
        <p className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
          {t(`register.${item.register}` as "register.colloquial")}
          {item.regionLabel ? ` · ${item.regionLabel}` : ""}
        </p>
      ) : null}

      <AudioPlayer
        sources={item.audio}
        autoplay={autoplayAudio}
        labels={{
          play: t("audio.play"),
          pause: t("audio.pause"),
          replay: t("audio.replay"),
          slow: t("audio.slow"),
          otherVoices: t("audio.otherVoices"),
          generatedVoice: t("audio.generatedVoice"),
          unavailable: t("audio.unavailable"),
        }}
      />

      {/* The context note is the thing that makes a phrase memorable. */}
      {item.contextNote ? (
        <p className="border-l-2 border-accent pl-3 text-left text-sm text-muted-foreground">
          {item.contextNote}
        </p>
      ) : null}

      {item.teachingNoteDe ? (
        <p className="text-sm text-muted-foreground">{item.teachingNoteDe}</p>
      ) : null}

      {item.notes ? <p className="text-sm text-muted-foreground">{item.notes}</p> : null}
    </div>
  );
}

function PracticeStep({
  item,
  labels,
}: {
  item: LessonView["items"][number];
  labels: { title: string; hint: string; check: string; correct: string; wrong: string };
}) {
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState(false);

  const practice = item.practice;
  if (!practice) return null;

  const tokens = item.slovene.split(/\s+/);
  const blanked = tokens
    .map((token, index) => (index === practice.position ? "____" : token))
    .join(" ");

  const outcome = checked ? compareAnswer(value, practice.answer) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 text-center">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {labels.title}
        </p>
        {/* Low stakes, and it says so: nothing here reaches the scheduler. */}
        <p className="text-xs text-muted-foreground">{labels.hint}</p>
      </div>

      <p className="slovene text-balance text-center text-2xl leading-snug">{blanked}</p>
      <p className="text-center text-muted-foreground">{item.german}</p>

      <Input
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setChecked(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") setChecked(true);
        }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        className="slovene text-center text-xl"
        aria-label={labels.title}
      />

      {practice.hintDe ? (
        <p className="text-center text-sm text-muted-foreground">{practice.hintDe}</p>
      ) : null}

      {!checked ? (
        <Button variant="outline" block onClick={() => setChecked(true)}>
          {labels.check}
        </Button>
      ) : (
        <div
          className={cn(
            "rounded-lg px-4 py-3 text-center",
            outcome?.verdict === "wrong" ? "bg-secondary" : "bg-accent-soft/50",
          )}
        >
          <p className="text-sm font-medium">
            {outcome?.verdict === "wrong" ? labels.wrong : labels.correct}
          </p>
          {outcome?.verdict === "wrong" ? (
            <p className="slovene mt-1 text-lg">{practice.answer}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
