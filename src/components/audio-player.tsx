"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Turtle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AudioSource = {
  id: string;
  kind: "tts" | "human_recording";
  src: string;
  fallbackSrc: string | null;
  speakerLabel: string | null;
};

type Labels = {
  play: string;
  pause: string;
  replay: string;
  slow: string;
  otherVoices: string;
  generatedVoice: string;
  unavailable: string;
};

/**
 * The audio control for listening and speaking cards.
 *
 * Autoplay is attempted and allowed to fail: browsers block it until the user
 * has interacted with the page, and a card that throws an error because the
 * browser was being sensible is worse than one that waits for a tap.
 */
export function AudioPlayer({
  sources,
  labels,
  autoplay = false,
  className,
}: {
  sources: AudioSource[];
  labels: Labels;
  autoplay?: boolean;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  const current = sources[index];

  const play = useCallback(async (rate = 1) => {
    const element = audioRef.current;
    if (!element) return;
    element.playbackRate = rate;
    element.currentTime = 0;
    try {
      await element.play();
    } catch {
      // Autoplay policy, or no audio to play. Either way the button still works.
      setPlaying(false);
    }
  }, []);

  useEffect(() => {
    setFailed(false);
    if (!autoplay || !current) return;
    void play();
  }, [autoplay, current, play]);

  if (!current) {
    return (
      <p className={cn("text-center text-sm text-muted-foreground", className)}>
        {labels.unavailable}
      </p>
    );
  }

  const speaker =
    current.kind === "human_recording"
      ? (current.speakerLabel ?? labels.otherVoices)
      : labels.generatedVoice;

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setFailed(true)}
      >
        <source src={current.src} />
        {current.fallbackSrc ? <source src={current.fallbackSrc} /> : null}
      </audio>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="icon"
          variant="default"
          className="size-16 rounded-full"
          onClick={() => (playing ? audioRef.current?.pause() : void play())}
          aria-label={playing ? labels.pause : labels.play}
        >
          {playing ? <Pause className="size-7" /> : <Play className="size-7" />}
        </Button>

        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={() => void play()}
          aria-label={labels.replay}
        >
          <RotateCcw />
        </Button>

        {/* Slow playback: the single most useful control for a beginner. */}
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={() => void play(0.75)}
          aria-label={labels.slow}
        >
          <Turtle />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{speaker}</p>

      {sources.length > 1 ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Users className="size-4 text-muted-foreground" aria-hidden />
          {sources.map((source, position) => (
            <button
              key={source.id}
              type="button"
              onClick={() => {
                setIndex(position);
                setTimeout(() => void play(), 0);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                position === index
                  ? "border-primary bg-primary/10 font-medium"
                  : "border-border text-muted-foreground hover:bg-secondary",
              )}
            >
              {source.kind === "human_recording"
                ? (source.speakerLabel ?? labels.otherVoices)
                : labels.generatedVoice}
            </button>
          ))}
        </div>
      ) : null}

      {failed ? (
        <p role="status" className="text-xs text-muted-foreground">
          {labels.unavailable}
        </p>
      ) : null}
    </div>
  );
}
