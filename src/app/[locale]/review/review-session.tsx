"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AudioPlayer } from "@/components/audio-player";
import { useOffline } from "@/components/offline-provider";
import { compareAgainstAny } from "@/lib/answers/compare";
import {
  loadBundle,
  loadCursor,
  newEventId,
  queueReview,
  saveCursor,
} from "@/lib/offline/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, ChevronRight, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { CardPrompt } from "@/lib/session/service";
import type { CardRating } from "@/lib/srs/scheduler";
import { checkAnswer, getNextCard, submitAnswer, type CheckAnswerResult } from "./actions";
import { AskButton } from "./ask-button";
import { mediaUrl } from "@/lib/audio/resolve";
import { SpeakingCard } from "./speaking-card";

const RATINGS: CardRating[] = ["again", "hard", "good", "easy"];

/** Typed exercises grade the text; the others reveal and let her judge. */
const TYPED_EXERCISES = new Set(["production", "cloze", "dictation", "listening"]);

/** Exercises where the audio is the prompt, so nothing is shown until she answers. */
const AUDIO_FIRST_EXERCISES = new Set(["listening", "dictation"]);

/** Exercises whose typed answer is Slovene — those get the č/š/ž keys. */
const SLOVENE_ANSWER_EXERCISES = new Set(["production", "cloze", "dictation"]);

const DIACRITICS = ["č", "š", "ž"] as const;

export type NextLessonLink = { slug: string; title: string; minutes: number };

type Props = {
  sessionId: string;
  initialCard: CardPrompt | null;
  cursor: number;
  total: number;
  autoplayAudio: boolean;
  /** Offered on the done screen, for when she has time left. */
  nextLesson: NextLessonLink | null;
};

export function ReviewSession({
  sessionId,
  initialCard,
  cursor,
  total,
  autoplayAudio,
  nextLesson,
}: Props) {
  const t = useTranslations("review");

  const audioLabels = {
    play: t("audio.play"),
    pause: t("audio.pause"),
    replay: t("audio.replay"),
    slow: t("audio.slow"),
    slowShort: t("audio.slowShort"),
    otherVoices: t("audio.otherVoices"),
    generatedVoice: t("audio.generatedVoice"),
    unavailable: t("audio.unavailable"),
  };

  const [card, setCard] = useState<CardPrompt | null>(initialCard);
  const [position, setPosition] = useState(cursor);
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<CheckAnswerResult | null>(null);
  /** What the speech recogniser would suggest. She still taps the rating. */
  const [speechSuggestion, setSpeechSuggestion] = useState<CardRating | null>(null);
  /** "Weiß nicht": revealed without an attempt, so "Nochmal" is suggested. */
  const [gaveUp, setGaveUp] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [finished, setFinished] = useState(!initialCard);
  const [pending, startTransition] = useTransition();

  const { online, refreshQueue } = useOffline();
  /** The cached session, used only when the network is gone. */
  const offlineCards = useRef<CardPrompt[] | null>(null);
  const offlineIndex = useRef(0);

  const shownAt = useRef<number>(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    shownAt.current = Date.now();
    if (card && TYPED_EXERCISES.has(card.exerciseType)) inputRef.current?.focus();
  }, [card]);

  /*
   * Offline, the cached bundle takes over.
   *
   * It carries the whole queue including the answers, which the online path
   * deliberately never sends ahead of time — offline there is nobody to ask
   * later, so the trade is unavoidable and stops here.
   */
  useEffect(() => {
    if (online) return;
    let cancelled = false;

    void (async () => {
      const bundle = await loadBundle();
      if (cancelled || !bundle || bundle.sessionId !== sessionId) return;

      offlineCards.current = bundle.cards;
      const saved = await loadCursor();
      const at = saved?.sessionId === sessionId ? saved.cursor : bundle.cursor;
      offlineIndex.current = at;

      if (!card) {
        const next = bundle.cards[at];
        if (next) {
          setCard(next);
          setPosition(at);
          setFinished(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [card, online, sessionId]);

  const clearCardState = useCallback(() => {
    setRevealed(false);
    setTyped("");
    setResult(null);
    setSpeechSuggestion(null);
    setGaveUp(false);
    setShowHint(false);
  }, []);

  const advance = useCallback(() => {
    if (!online && offlineCards.current) {
      const at = offlineIndex.current;
      clearCardState();
      setPosition(at);
      void saveCursor(sessionId, at);
      const next = offlineCards.current[at];
      if (next) setCard(next);
      else setFinished(true);
      return;
    }

    startTransition(async () => {
      const next = await getNextCard({ sessionId });
      clearCardState();
      setPosition(next.cursor);
      if (next.card) setCard(next.card);
      else setFinished(true);
    });
  }, [clearCardState, online, sessionId]);

  const rate = useCallback(
    (rating: CardRating) => {
      if (!card || pending) return;
      const durationMs = Date.now() - shownAt.current;
      setAnswered((n) => n + 1);

      const ratingSource = speechSuggestion
        ? rating === speechSuggestion
          ? ("auto_speech" as const)
          : ("overridden" as const)
        : ("manual" as const);

      if (!online && offlineCards.current) {
        // Queued, then straight on to the next card. She never waits for a
        // network that is not there.
        void queueReview({
          clientEventId: newEventId(),
          sessionId,
          cardId: card.cardId,
          rating,
          reviewedAt: new Date().toISOString(),
          durationMs,
          ratingSource,
        }).then(refreshQueue);

        offlineIndex.current += 1;
        if (offlineIndex.current >= offlineCards.current.length) {
          clearCardState();
          setFinished(true);
        } else {
          advance();
        }
        return;
      }

      startTransition(async () => {
        const outcome = await submitAnswer({
          sessionId,
          cardId: card.cardId,
          rating,
          durationMs,
          ratingSource,
        });
        if (outcome.finished) setFinished(true);
        else advance();
      });
    },
    [advance, card, clearCardState, online, pending, refreshQueue, sessionId, speechSuggestion],
  );

  const check = useCallback(() => {
    if (!card || pending) return;

    if (!online && offlineCards.current) {
      /*
       * The same pure comparison the server runs, on the answers that came
       * down with the bundle — so "kavo" typed without the diacritic is still
       * counted right when she is on a train.
       */
      const comparison = compareAgainstAny(typed, card.acceptableAnswers);
      setResult({
        ...comparison,
        suggestedRating:
          comparison.verdict === "correct"
            ? "good"
            : comparison.verdict === "almost"
              ? "hard"
              : "again",
      });
      setRevealed(true);
      return;
    }

    startTransition(async () => {
      setResult(await checkAnswer({ cardId: card.cardId, answer: typed }));
      setRevealed(true);
    });
  }, [card, online, pending, typed]);

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

  if ((finished || !card) && answered === 0) {
    // Arrived with nothing due. Not an achievement screen — just a kind exit.
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <p className="text-lg text-muted-foreground">{t("empty")}</p>
        <Button asChild size="lg" className="h-14 rounded-2xl px-8 font-bold">
          <Link href="/">{t("emptyAction")}</Link>
        </Button>
      </main>
    );
  }

  if (finished || !card) {
    return (
      <main
        className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-4"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)" }}
      >
        <section className="flex flex-1 flex-col justify-center gap-3">
          <span
            aria-hidden
            className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary"
          >
            <Check className="size-7" strokeWidth={2.5} />
          </span>
          <h1 className="mt-2 text-4xl font-bold leading-tight tracking-tight">{t("done.title")}</h1>
          <p className="text-lg text-muted-foreground">
            {t("done.body", { count: answered })} {t("done.saved")}
          </p>
        </section>
        <div className="flex flex-col gap-2.5">
          {nextLesson ? (
            <Link
              href={`/lessons/${nextLesson.slug}`}
              className="flex items-center gap-3.5 rounded-2xl bg-card px-4 py-3.5 transition-colors hover:bg-secondary"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm text-muted-foreground">
                  {t("done.more", { minutes: nextLesson.minutes })}
                </span>
                <span className="truncate text-lg font-bold">
                  {t("done.continueLesson", { title: nextLesson.title })}
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          ) : null}
          <Button asChild size="lg" block className="h-14 rounded-2xl font-bold">
            <Link href="/">{t("done.home")}</Link>
          </Button>
        </div>
      </main>
    );
  }

  const isTyped = TYPED_EXERCISES.has(card.exerciseType);
  const isAudioFirst = AUDIO_FIRST_EXERCISES.has(card.exerciseType);
  const isSpeaking = card.exerciseType === "speaking";
  const answersInSlovene = SLOVENE_ANSWER_EXERCISES.has(card.exerciseType);
  const suggestedRating =
    result?.suggestedRating ?? speechSuggestion ?? (gaveUp ? ("again" as const) : null);

  const insert = (character: string) => {
    const input = inputRef.current;
    const startAt = input?.selectionStart ?? typed.length;
    const endAt = input?.selectionEnd ?? typed.length;
    setTyped(typed.slice(0, startAt) + character + typed.slice(endAt));
    // Keep the keyboard up and the caret after the inserted letter.
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(startAt + 1, startAt + 1);
    });
  };

  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-4"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)" }}
    >
      <header className="flex items-center gap-3">
        {/* Leaving is pausing: the cursor lives on the server. */}
        <Link
          href="/"
          aria-label={t("close")}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-secondary"
        >
          <X className="size-5" />
        </Link>
        <div aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${(position / total) * 100}%` }}
          />
        </div>
        <span aria-live="polite" className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {t("progress", { current: Math.min(position + 1, total), total })}
        </span>
        <AskButton key={card.cardId} cardId={card.cardId} />
      </header>

      {card.isNew ? (
        <p className="mt-4 self-center rounded-full bg-accent-soft px-3 py-1 text-xs font-bold uppercase tracking-[0.1em] text-accent-soft-foreground">
          {t("newBadge")}
        </p>
      ) : null}

      <section className="flex flex-1 flex-col justify-center gap-5 py-6">
        {isSpeaking ? (
          <SpeakingCard
            key={card.cardId}
            cardId={card.cardId}
            sessionId={sessionId}
            prompt={card.german}
            slovene={card.slovene}
            audio={card.audio}
            online={online}
            onResult={(suggested) => {
              setSpeechSuggestion(suggested);
              setRevealed(true);
            }}
            onSkip={() => setRevealed(true)}
          />
        ) : null}

        {!isSpeaking && !revealed ? (
          <div className="flex flex-col items-center gap-3.5 px-2 text-center">
            {/* The screen's heading is the prompt; with no prompt, the instruction. */}
            <PromptLabel asHeading={!card.prompt}>
              {card.exerciseType === "cloze"
                ? t("cloze")
                : isAudioFirst
                  ? t("listenPrompt")
                  : answersInSlovene
                    ? t("typeSlovene")
                    : t("translate")}
            </PromptLabel>

            {isAudioFirst ? (
              <AudioPlayer
                sources={card.audio}
                labels={audioLabels}
                autoplay={autoplayAudio}
                key={card.cardId}
              />
            ) : null}

            {card.prompt ? (
              <h1
                lang={card.exerciseType === "recognition" || card.exerciseType === "cloze" ? "sl" : undefined}
                className={cn(
                  "text-balance font-bold leading-tight tracking-tight",
                  card.exerciseType === "recognition" || card.exerciseType === "cloze"
                    ? "slovene font-semibold"
                    : "",
                  card.prompt.length > 40 ? "text-2xl" : "text-[2rem]",
                )}
              >
                {card.prompt}
              </h1>
            ) : null}

            {card.register !== "standard" ? (
              <p className="text-sm text-muted-foreground">
                {t(`register.${card.register}` as "register.colloquial")}
                {card.regionLabel ? ` · ${card.regionLabel}` : ""}
              </p>
            ) : null}

            {showHint && card.hintDe ? (
              <p className="rounded-xl bg-accent-soft px-3.5 py-2 text-sm text-accent-soft-foreground">
                {t("hint")}: {card.hintDe}
              </p>
            ) : null}
          </div>
        ) : null}

        {revealed && !isSpeaking ? (
          <>
            {result ? (
              <p
                className={cn(
                  "flex items-center gap-2 self-center rounded-full px-3.5 py-2 text-[0.95rem] font-bold",
                  result.verdict === "correct" && "bg-primary-soft text-primary",
                  result.verdict === "almost" && "bg-accent-soft text-accent-soft-foreground",
                  result.verdict === "wrong" && "bg-secondary text-foreground",
                )}
              >
                {/* Never colour alone: the wording carries the verdict too. */}
                <span aria-hidden>
                  {result.verdict === "correct" ? "✓" : result.verdict === "almost" ? "≈" : "–"}
                </span>
                {t(`verdict.${result.verdict}` as "verdict.correct")}
              </p>
            ) : null}

            <div className="flex flex-col items-center gap-3.5 rounded-3xl bg-card px-5 py-6 text-center">
              {result && result.verdict !== "correct" && typed.trim() ? (
                <p className="text-[0.95rem] text-muted-foreground">
                  {t("yourAnswer")}:{" "}
                  <span lang={answersInSlovene ? "sl" : undefined} className={cn("text-foreground", answersInSlovene && "slovene")}>
                    {typed}
                  </span>
                </p>
              ) : null}

              <h1 lang="sl" className="slovene text-balance text-4xl font-semibold leading-tight">
                {card.slovene}
              </h1>
              <p className="text-lg text-muted-foreground">{card.german}</p>

              {/* After answering, the audio stays available to imitate. */}
              {card.audio.length ? (
                <AudioPlayer sources={card.audio} labels={audioLabels} key={`${card.cardId}-after`} />
              ) : null}

              {result?.diacriticsOnly ? (
                <p className="text-sm text-muted-foreground">{t("diacriticsHint")}</p>
              ) : null}

              {card.contextNote ? (
                <p className="w-full border-t border-border pt-3.5 text-[0.95rem] leading-relaxed text-muted-foreground">
                  {card.contextNote}
                </p>
              ) : null}

              {/*
                Answers stay on the card from then on. Asking once should pay
                off every time she meets the item again.
              */}
              {card.answers.map((answer) => (
                <div
                  key={answer.questionId}
                  className="flex w-full flex-col gap-2 border-t border-border pt-3.5 text-left"
                >
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    {t("ask.answerTitle")}
                  </p>
                  {answer.answerText ? (
                    <p className="text-sm leading-relaxed">{answer.answerText}</p>
                  ) : null}
                  {answer.answerAudioPath ? (
                    <audio controls preload="none" className="h-9 w-full">
                      <source src={mediaUrl(answer.answerAudioPath)} />
                    </audio>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <footer className="flex flex-col gap-2.5">
        {!revealed ? (
          isSpeaking ? null : isTyped ? (
            <>
              <label
                htmlFor="answer"
                className="text-sm font-bold text-muted-foreground"
              >
                {t("yourAnswer")}
              </label>
              <Input
                id="answer"
                ref={inputRef}
                lang={answersInSlovene ? "sl" : undefined}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    check();
                  }
                }}
                placeholder={isAudioFirst ? t("typeGerman") : t("typeAnswer")}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className={cn(
                  "h-[60px] rounded-2xl border-2 border-primary px-4.5 text-2xl",
                  answersInSlovene && "slovene",
                )}
              />
              <div className="flex gap-2" role="group" aria-label={t("diacritics")}>
                {answersInSlovene
                  ? DIACRITICS.map((character) => (
                      <button
                        key={character}
                        type="button"
                        // Keep focus (and the phone keyboard) in the input.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insert(character)}
                        className="slovene h-12 flex-1 rounded-xl border border-input bg-card text-2xl transition-colors hover:bg-secondary"
                      >
                        {character}
                      </button>
                    ))
                  : null}
                {card.hintDe && !showHint ? (
                  <button
                    type="button"
                    onClick={() => setShowHint(true)}
                    className="h-12 flex-[1.6] rounded-xl px-3 text-[0.95rem] font-bold text-primary transition-colors hover:bg-secondary"
                  >
                    {t("showHint")}
                  </button>
                ) : null}
              </div>
              <div className="mt-1.5 flex gap-2.5">
                <Button
                  variant="outline"
                  className="h-14 rounded-2xl border-0 bg-card px-5 font-bold"
                  onClick={() => {
                    setGaveUp(true);
                    setRevealed(true);
                  }}
                  disabled={pending}
                >
                  {t("dontKnow")}
                </Button>
                <Button
                  size="lg"
                  className="h-14 flex-1 rounded-2xl font-bold"
                  onClick={check}
                  disabled={pending}
                >
                  {t("check")}
                </Button>
              </div>
            </>
          ) : (
            <Button
              size="lg"
              block
              className="h-14 rounded-2xl font-bold"
              onClick={() => setRevealed(true)}
              disabled={pending}
            >
              {t("show")}
            </Button>
          )
        ) : (
          <>
            <p id="how-was-it" className="text-center text-sm font-bold text-muted-foreground">
              {t("howWasIt")}
            </p>
            <div role="group" aria-labelledby="how-was-it" className="grid grid-cols-4 gap-2">
              {RATINGS.map((rating) => {
                const suggested = suggestedRating === rating;
                return (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => rate(rating)}
                    disabled={pending}
                    aria-describedby={`rating-hint-${rating}`}
                    className={cn(
                      "flex h-[72px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-center transition-colors disabled:opacity-50",
                      suggested
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                        : "border border-border bg-card text-foreground hover:bg-secondary",
                    )}
                  >
                    <span className="text-base font-bold">
                      {t(`rating.${rating}` as "rating.good")}
                    </span>
                    <span
                      id={`rating-hint-${rating}`}
                      className={cn(
                        "text-balance break-words text-xs leading-tight",
                        suggested ? "font-bold" : "text-muted-foreground",
                      )}
                    >
                      {suggested ? t("suggestedShort") : t(`ratingHint.${rating}` as "ratingHint.good")}
                    </span>
                  </button>
                );
              })}
            </div>

            {suggestedRating ? (
              <p className="text-center text-sm text-muted-foreground">{t("suggestedHint")}</p>
            ) : null}

            {isSpeaking && speechSuggestion && speechSuggestion !== "good" ? (
              <Button
                variant="ghost"
                size="sm"
                block
                onClick={() => rate("good")}
                disabled={pending}
              >
                {t("speaking.override")}
              </Button>
            ) : null}
          </>
        )}
      </footer>
    </main>
  );
}

const PROMPT_LABEL_CLASS =
  "text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground";

function PromptLabel({
  asHeading,
  children,
}: {
  asHeading: boolean;
  children: React.ReactNode;
}) {
  return asHeading ? (
    <h1 className={PROMPT_LABEL_CLASS}>{children}</h1>
  ) : (
    <p className={PROMPT_LABEL_CLASS}>{children}</p>
  );
}
