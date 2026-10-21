"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Check, SkipForward } from "lucide-react";
import { useTranslations } from "next-intl";
import { SpeechRecorder, type RecordingResult } from "@/components/speech-recorder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RecordingQueueItem } from "@/lib/teacher/recordings";
import { fetchRecordingQueue, uploadRecording } from "../actions";

const SPEAKER_KEY = "dober-dan.recording-speaker";

/**
 * Working through the queue.
 *
 * The speaker label is asked once and kept, because it does not change inside
 * a sitting — it is one person at a microphone, and retyping "Oma" three
 * hundred times is the kind of friction that stops the recordings happening at
 * all.
 */
export function RecordQueue({
  initialQueue,
  remaining,
}: {
  initialQueue: RecordingQueueItem[];
  remaining: number;
}) {
  const t = useTranslations("teacher.record");
  const tRecorder = useTranslations("review.speaking");

  const [queue, setQueue] = useState(initialQueue);
  const [left, setLeft] = useState(remaining);
  const [speaker, setSpeaker] = useState("");
  const [recorded, setRecorded] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const current = queue[0];

  /*
   * Remembered across sittings. It is the same handful of voices every time,
   * and getting it wrong is cheap to fix from the item editor.
   */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SPEAKER_KEY);
      if (stored) setSpeaker(stored);
    } catch {
      // Private window, or storage blocked. Typing it once still works.
    }
  }, []);

  const rememberSpeaker = useCallback((value: string) => {
    setSpeaker(value);
    try {
      localStorage.setItem(SPEAKER_KEY, value);
    } catch {
      // Not worth telling her about: the label is already in the field.
    }
  }, []);

  /** Drops the head of the queue, refilling from the server when it empties. */
  const advance = useCallback(() => {
    setRecorded(null);
    setQueue((rest) => {
      const next = rest.slice(1);
      if (next.length === 0) {
        void fetchRecordingQueue()
          .then((batch) => setQueue(batch))
          .catch(() => setError(t("failed")));
      }
      return next;
    });
  }, [t]);

  const keep = useCallback(() => {
    if (!current || !recorded) return;
    if (!speaker.trim()) {
      setError(t("speakerRequired"));
      return;
    }
    setError(null);

    const form = new FormData();
    form.set("kind", current.kind);
    form.set("itemId", current.id);
    form.set("speakerLabel", speaker.trim());
    form.set("durationMs", String(recorded.durationMs));
    form.set("audio", recorded.blob, `voice.${recorded.mimeType.split("/")[1] ?? "webm"}`);

    startTransition(async () => {
      try {
        await uploadRecording(form);
        setLeft((value) => Math.max(0, value - 1));
        setJustSaved(true);
        advance();
      } catch {
        // The recording is still in state, so she can simply press keep again.
        setError(t("failed"));
      }
    });
  }, [advance, current, recorded, speaker, t]);

  // The confirmation is a flash, not a state to dismiss.
  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 1600);
    return () => clearTimeout(timer);
  }, [justSaved]);

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-lg font-medium">{t("done")}</h2>
        <p className="text-sm text-muted-foreground">{t("doneBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="speaker">{t("speaker")}</Label>
        <Input
          id="speaker"
          value={speaker}
          onChange={(event) => rememberSpeaker(event.target.value)}
          placeholder="Oma"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t("speakerHint")}</p>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {current.kind === "phrase" ? t("phraseLabel") : t("wordLabel")}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("remaining", { count: left })}
          </span>
        </div>

        <p className="slovene text-balance text-3xl leading-tight">{current.slovene}</p>
        {current.german ? <p className="text-muted-foreground">{current.german}</p> : null}

        {current.contextNote ? (
          <p className="border-t border-border pt-3 text-sm text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">{t("contextLabel")}</span>{" "}
            {current.contextNote}
          </p>
        ) : null}
      </div>

      {/* Keyed per item so the recorder clears itself between phrases. */}
      <SpeechRecorder
        key={`${current.kind}-${current.id}`}
        disabled={pending}
        onRecorded={setRecorded}
        labels={{
          start: tRecorder("start"),
          stop: tRecorder("stop"),
          recording: tRecorder("recording"),
          permissionDenied: tRecorder("permissionDenied"),
          unsupported: tRecorder("unsupported"),
          listenBack: tRecorder("listenBack"),
        }}
      />

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={advance} disabled={pending} className="flex-1">
          <SkipForward />
          {t("skip")}
        </Button>
        <Button onClick={keep} disabled={pending || !recorded} className="flex-1">
          <Check />
          {pending ? t("saving") : t("keep")}
        </Button>
      </div>

      <p className="min-h-5 text-center text-sm" aria-live="polite">
        {error ? (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        ) : justSaved ? (
          <span className="text-muted-foreground">{t("saved")}</span>
        ) : null}
      </p>
    </div>
  );
}
