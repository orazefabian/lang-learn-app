"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type RecordingResult = {
  blob: Blob;
  mimeType: string;
  durationMs: number;
};

type Labels = {
  start: string;
  stop: string;
  recording: string;
  permissionDenied: string;
  unsupported: string;
  listenBack: string;
};

/**
 * Picks a container the browser can actually produce. Chromium and Firefox give
 * webm/opus; Safari only offers mp4. All three are decodable by the recogniser.
 */
function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

/**
 * Records one attempt.
 *
 * Deliberately one big button. This is used one-handed, on a phone, by someone
 * who is already nervous about speaking out loud.
 */
export function SpeechRecorder({
  labels,
  disabled,
  onRecorded,
  className,
}: {
  labels: Labels;
  disabled?: boolean;
  onRecorded: (result: RecordingResult) => void;
  className?: string;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [cleanup, previewUrl]);

  const start = useCallback(async () => {
    setError(null);
    const mimeType = pickMimeType();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      setError(labels.unsupported);
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setError(labels.permissionDenied);
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    startedAtRef.current = Date.now();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      const blob = new Blob(chunksRef.current, { type: mimeType });
      cleanup();
      setRecording(false);

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));

      // Split the container off the codec parameters before sending it on.
      onRecorded({ blob, mimeType: mimeType.split(";")[0] as string, durationMs });
    };

    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      // A safety stop: nobody needs to record a phrase for a minute.
      if (Date.now() - startedAtRef.current > 60_000) recorder.stop();
    }, 200);
  }, [cleanup, labels.permissionDenied, labels.unsupported, onRecorded, previewUrl]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <Button
        type="button"
        size="icon"
        variant={recording ? "destructive" : "default"}
        className={cn("size-20 rounded-full", recording && "animate-pulse")}
        onClick={() => (recording ? stop() : void start())}
        disabled={disabled}
        aria-label={recording ? labels.stop : labels.start}
      >
        {recording ? <Square className="size-8" /> : <Mic className="size-8" />}
      </Button>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {recording ? `${labels.recording} · ${elapsed}s` : labels.start}
      </p>

      {previewUrl && !recording ? (
        <div className="flex flex-col items-center gap-1">
          <p className="text-xs text-muted-foreground">{labels.listenBack}</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio src={previewUrl} controls className="h-9" />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
