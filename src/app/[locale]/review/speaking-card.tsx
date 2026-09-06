"use client";

import { useCallback, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AudioPlayer, type AudioSource } from "@/components/audio-player";
import { SpeechRecorder, type RecordingResult } from "@/components/speech-recorder";
import { Button } from "@/components/ui/button";
import { newEventId, queueSpeech } from "@/lib/offline/store";
import { cn } from "@/lib/utils";
import type { CardRating } from "@/lib/srs/scheduler";
import { submitSpeechAttempt, type SpeechAttemptResponse } from "./actions";

type Props = {
  cardId: string;
  sessionId: string;
  /** The German side: what she is asked to say. */
  prompt: string;
  /** The Slovene target, revealed once she has recorded. */
  slovene: string;
  audio: AudioSource[];
  /** Offline the recording is kept and scored on reconnect. */
  online: boolean;
  onResult: (suggested: CardRating | null) => void;
};

/**
 * The speaking exercise.
 *
 * The scoring is presented as *what the recogniser understood*, never as a
 * verdict on her pronunciation, because Whisper cannot judge pronunciation.
 * She always taps the rating herself, so a misheard word costs her nothing.
 */
export function SpeakingCard({
  cardId,
  sessionId,
  prompt,
  slovene,
  audio,
  online,
  onResult,
}: Props) {
  const t = useTranslations("review");
  const [result, setResult] = useState<SpeechAttemptResponse | null>(null);
  const [pending, startTransition] = useTransition();

  const audioLabels = {
    play: t("audio.play"),
    pause: t("audio.pause"),
    replay: t("audio.replay"),
    slow: t("audio.slow"),
    otherVoices: t("audio.otherVoices"),
    generatedVoice: t("audio.generatedVoice"),
    unavailable: t("audio.unavailable"),
  };

  const handleRecorded = useCallback(
    (recording: RecordingResult) => {
      if (!online) {
        /*
         * Kept, not scored. Whisper is not reachable, so the recording waits in
         * IndexedDB and is uploaded and transcribed on reconnect. She judges
         * this one herself — which she does online too, so nothing about the
         * card changes except that the transcript arrives later or not at all.
         */
        void queueSpeech({
          clientEventId: newEventId(),
          cardId,
          sessionId,
          recordedAt: new Date().toISOString(),
          durationMs: recording.durationMs,
          mimeType: recording.mimeType,
          blob: recording.blob,
        });

        setResult({
          status: "pending",
          transcript: null,
          band: null,
          suggestedRating: null,
          charSimilarity: null,
          diff: [],
          reason: "offline",
        });
        onResult(null);
        return;
      }

      const form = new FormData();
      form.set("cardId", cardId);
      form.set("sessionId", sessionId);
      form.set("durationMs", String(recording.durationMs));
      form.set("audio", recording.blob, `attempt.${recording.mimeType.split("/")[1]}`);

      startTransition(async () => {
        try {
          const response = await submitSpeechAttempt(form);
          setResult(response);
          onResult(response.suggestedRating);
        } catch {
          // The recording is stored server-side before scoring, so a failure
          // here costs the feedback, not the attempt.
          setResult({
            status: "failed",
            transcript: null,
            band: null,
            suggestedRating: null,
            charSimilarity: null,
            diff: [],
          });
          onResult(null);
        }
      });
    },
    [cardId, onResult, online, sessionId],
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-center text-sm text-muted-foreground">{t("speaking.prompt")}</p>
      <p className="text-balance text-center text-2xl font-semibold tracking-tight">{prompt}</p>

      {!result ? (
        <SpeechRecorder
          disabled={pending}
          onRecorded={handleRecorded}
          labels={{
            start: t("speaking.start"),
            stop: t("speaking.stop"),
            recording: t("speaking.recording"),
            permissionDenied: t("speaking.permissionDenied"),
            unsupported: t("speaking.unsupported"),
            listenBack: t("speaking.listenBack"),
          }}
        />
      ) : null}

      {pending ? (
        <p className="text-center text-sm text-muted-foreground" aria-live="polite">
          {t("speaking.checking")}
        </p>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
          <p className="text-center text-2xl font-semibold tracking-tight">{slovene}</p>

          {result.status === "scored" ? (
            <>
              <p
                className={cn(
                  "text-center text-sm font-medium",
                  result.band === "off" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {/* Wording carries the verdict; colour never carries it alone. */}
                {result.band === "good"
                  ? `✓ ${t("speaking.band.good")}`
                  : result.band === "close"
                    ? `≈ ${t("speaking.band.close")}`
                    : `– ${t("speaking.band.off")}`}
              </p>

              {result.transcript ? (
                <div className="flex flex-col gap-2">
                  <p className="text-center text-xs uppercase tracking-wide text-muted-foreground">
                    {t("speaking.understoodAs")}
                  </p>
                  {/*
                    The diff shows *what* differed, word by word: struck-through
                    words were expected but not heard, underlined ones were heard
                    but not expected.
                  */}
                  <p className="text-balance text-center text-lg">
                    {result.diff.map((segment, index) => (
                      <span
                        key={`${segment.kind}-${index}-${segment.text}`}
                        className={cn(
                          segment.kind === "missing" && "text-muted-foreground line-through",
                          segment.kind === "extra" && "underline decoration-dotted",
                        )}
                      >
                        {segment.text}{" "}
                      </span>
                    ))}
                  </p>
                </div>
              ) : (
                <p className="text-center text-sm text-muted-foreground">
                  {t("speaking.nothingHeard")}
                </p>
              )}

              <p className="border-t border-border pt-3 text-center text-xs text-muted-foreground">
                {t("speaking.disclaimer")}
              </p>
            </>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              {result.status === "pending" ? t("speaking.selfAssess") : t("speaking.failed")}
            </p>
          )}

          {audio.length ? (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <p className="text-center text-xs uppercase tracking-wide text-muted-foreground">
                {t("speaking.modelAudio")}
              </p>
              <AudioPlayer sources={audio} labels={audioLabels} />
            </div>
          ) : null}

          <Button variant="ghost" onClick={() => setResult(null)} disabled={pending}>
            {t("speaking.retry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
