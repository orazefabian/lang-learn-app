"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { CardPrompt } from "@/lib/session/service";
import type { CardRating } from "@/lib/srs/scheduler";
import { checkAnswer, getNextCard, submitAnswer, type CheckAnswerResult } from "./actions";

const RATINGS: CardRating[] = ["again", "hard", "good", "easy"];

/** Typed exercises grade the text; the others reveal and let her judge. */
const TYPED_EXERCISES = new Set(["production", "cloze", "dictation"]);

type Props = {
  sessionId: string;
  initialCard: CardPrompt | null;
  cursor: number;
  total: number;
  autoplayAudio: boolean;
};

export function ReviewSession({ sessionId, initialCard, cursor, total }: Props) {
  const t = useTranslations("review");

  const [card, setCard] = useState<CardPrompt | null>(initialCard);
  const [position, setPosition] = useState(cursor);
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<CheckAnswerResult | null>(null);
  const [answered, setAnswered] = useState(0);
  const [finished, setFinished] = useState(!initialCard);
  const [pending, startTransition] = useTransition();

  const shownAt = useRef<number>(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    shownAt.current = Date.now();
    if (card && TYPED_EXERCISES.has(card.exerciseType)) inputRef.current?.focus();
  }, [card]);

  const advance = useCallback(() => {
    startTransition(async () => {
      const next = await getNextCard({ sessionId });
      setRevealed(false);
      setTyped("");
      setResult(null);
      setPosition(next.cursor);
      if (next.card) setCard(next.card);
      else setFinished(true);
    });
  }, [sessionId]);

  const rate = useCallback(
    (rating: CardRating) => {
      if (!card || pending) return;
      const durationMs = Date.now() - shownAt.current;
      setAnswered((n) => n + 1);
      startTransition(async () => {
        const outcome = await submitAnswer({
          sessionId,
          cardId: card.cardId,
          rating,
          durationMs,
        });
        if (outcome.finished) setFinished(true);
        else advance();
      });
    },
    [advance, card, pending, sessionId],
  );

  const check = useCallback(() => {
    if (!card || pending) return;
    startTransition(async () => {
      setResult(await checkAnswer({ cardId: card.cardId, answer: typed }));
      setRevealed(true);
    });
  }, [card, pending, typed]);

  // Keyboard shortcuts for desktop: 1–4 rate, space reveals.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement && event.key !== "Enter") return;
      if (!revealed && event.key === " ") {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed) {
        const index = Number.parseInt(event.key, 10);
        if (index >= 1 && index <= 4) {
          event.preventDefault();
          rate(RATINGS[index - 1] as CardRating);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rate, revealed]);

  if (finished || !card) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("done.title")}</h1>
        <p className="text-muted-foreground">{t("done.body", { count: answered })}</p>
        <div className="flex w-full flex-col gap-3">
          <Button asChild size="lg" block>
            <Link href="/">{t("done.home")}</Link>
          </Button>
        </div>
      </main>
    );
  }

  const isTyped = TYPED_EXERCISES.has(card.exerciseType);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-4">
      <header className="flex items-center justify-between text-sm text-muted-foreground">
        <span aria-live="polite">
          {t("progress", { current: Math.min(position + 1, total), total })}
        </span>
        {card.isNew ? (
          <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
            {t("newBadge")}
          </span>
        ) : null}
      </header>

      <div
        aria-hidden
        className="mt-3 h-1 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${(position / total) * 100}%` }}
        />
      </div>

      <section className="flex flex-1 flex-col justify-center gap-6 py-8">
        {card.exerciseType === "cloze" ? (
          <p className="text-center text-sm text-muted-foreground">{t("cloze")}</p>
        ) : null}

        <p
          className={cn(
            "text-balance text-center font-semibold tracking-tight",
            card.prompt.length > 40 ? "text-2xl" : "text-3xl",
          )}
        >
          {card.prompt}
        </p>

        {card.register !== "standard" ? (
          <p className="text-center text-sm text-muted-foreground">
            {t(`register.${card.register}` as "register.colloquial")}
            {card.regionLabel ? ` · ${card.regionLabel}` : ""}
          </p>
        ) : null}

        {isTyped && !revealed ? (
          <div className="flex flex-col gap-3">
            <label className="sr-only" htmlFor="answer">
              {t("typeSlovene")}
            </label>
            <Input
              id="answer"
              ref={inputRef}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  check();
                }
              }}
              placeholder={t("typeAnswer")}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="text-center text-xl"
            />
            {card.hintDe ? (
              <p className="text-center text-sm text-muted-foreground">
                {t("hint")}: {card.hintDe}
              </p>
            ) : null}
          </div>
        ) : null}

        {revealed ? (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
            {result ? (
              <p
                className={cn(
                  "text-center text-sm font-medium",
                  result.verdict === "wrong" ? "text-destructive" : "text-foreground",
                )}
              >
                {/* Never colour alone: the wording carries the verdict too. */}
                {result.verdict === "correct"
                  ? `✓ ${t("verdict.correct")}`
                  : result.verdict === "almost"
                    ? `≈ ${t("verdict.almost")}`
                    : `– ${t("verdict.wrong")}`}
              </p>
            ) : null}

            <p className="text-center text-2xl font-semibold tracking-tight">{card.slovene}</p>
            <p className="text-center text-lg text-muted-foreground">{card.german}</p>

            {result?.diacriticsOnly ? (
              <p className="text-center text-sm text-muted-foreground">{t("diacriticsHint")}</p>
            ) : null}

            {card.contextNote ? (
              <p className="border-t border-border pt-4 text-center text-sm text-muted-foreground">
                {card.contextNote}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <footer className="flex flex-col gap-3">
        {!revealed ? (
          isTyped ? (
            <Button size="lg" block onClick={check} disabled={pending}>
              {t("check")}
            </Button>
          ) : (
            <Button size="lg" block onClick={() => setRevealed(true)} disabled={pending}>
              {t("show")}
            </Button>
          )
        ) : (
          <>
            <p className="text-center text-sm text-muted-foreground">{t("howWasIt")}</p>
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map((rating) => {
                const suggested = result?.suggestedRating === rating;
                return (
                  <Button
                    key={rating}
                    variant={suggested ? "default" : "outline"}
                    className="h-auto flex-col gap-1 px-2 py-3"
                    onClick={() => rate(rating)}
                    disabled={pending}
                    aria-label={`${t(`rating.${rating}` as "rating.good")} — ${t(`ratingHint.${rating}` as "ratingHint.good")}`}
                  >
                    <span className="text-sm font-medium">
                      {t(`rating.${rating}` as "rating.good")}
                    </span>
                    <span className="text-[0.7rem] font-normal opacity-70">
                      {t(`ratingHint.${rating}` as "ratingHint.good")}
                    </span>
                  </Button>
                );
              })}
            </div>
          </>
        )}
      </footer>
    </main>
  );
}
