"use client";

import { useRef, useState, useTransition } from "react";
import { Mic } from "lucide-react";
import { useTranslations } from "next-intl";
import { SpeechRecorder, type RecordingResult } from "@/components/speech-recorder";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { answerInboxQuestion } from "../actions";

/**
 * Answering: text, a voice note, or both.
 *
 * The voice note is often the better answer — explaining a case ending out loud
 * takes ten seconds and typing it takes two minutes — so recording is one tap
 * away rather than hidden behind a menu.
 */
export function AnswerForm({
  questionId,
  answered,
}: {
  questionId: string;
  answered: boolean;
}) {
  const t = useTranslations("teacher.inbox");
  const router = useRouter();

  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [voice, setVoice] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(!answered);
  const previewRef = useRef<string | null>(null);

  function send() {
    if (!text.trim() && !voice) {
      setError(t("needsSomething"));
      return;
    }
    setError(null);

    const form = new FormData();
    form.set("questionId", questionId);
    if (text.trim()) form.set("text", text.trim());
    if (voice) {
      form.set("durationMs", String(voice.durationMs));
      form.set("audio", voice.blob, `answer.${voice.mimeType.split("/")[1] ?? "webm"}`);
    }

    startTransition(async () => {
      await answerInboxQuestion(form);
      setSent(true);
      setText("");
      setVoice(null);
      router.refresh();
    });
  }

  if (sent) {
    return (
      <p className="text-sm text-primary" role="status">
        {t("sent")}
      </p>
    );
  }

  if (!expanded) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
        {t("answerLabel")}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="sr-only" htmlFor={`answer-${questionId}`}>
        {t("answerLabel")}
      </label>
      <textarea
        id={`answer-${questionId}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        placeholder={t("answerPlaceholder")}
        className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
      />

      {recording ? (
        <SpeechRecorder
          labels={{
            start: t("recordAnswer"),
            stop: t("stopRecording"),
            recording: t("recordAnswer"),
            permissionDenied: t("needsSomething"),
            unsupported: t("needsSomething"),
            listenBack: t("answerLabel"),
          }}
          onRecorded={(result) => {
            if (previewRef.current) URL.revokeObjectURL(previewRef.current);
            previewRef.current = URL.createObjectURL(result.blob);
            setVoice(result);
            setRecording(false);
          }}
        />
      ) : (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setRecording(true)}>
            <Mic className="size-4" />
            {t("recordAnswer")}
          </Button>
          {voice ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio controls src={previewRef.current ?? undefined} className="h-9 flex-1" />
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button size="sm" onClick={send} disabled={pending}>
        {pending ? t("sending") : t("send")}
      </Button>
    </div>
  );
}
