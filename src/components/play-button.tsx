"use client";

import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { AudioSource } from "@/components/audio-player";
import { cn } from "@/lib/utils";

/**
 * A single round play button for lists — the phrasebook, the home strip.
 *
 * The full AudioPlayer (replay, slow, other voices) belongs on a card she is
 * studying; in a list of twenty phrases it would be noise. One tap, one voice.
 */
export function PlayButton({
  sources,
  label,
  text,
  className,
}: {
  sources: AudioSource[];
  /** Accessible name, e.g. "Dober tek! anhören". */
  label: string;
  /** Visible text; turns the round icon button into a pill. */
  text?: string;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const source = sources[0];

  if (!source) return null;

  return (
    <>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      >
        <source src={source.src} />
        {source.fallbackSrc ? <source src={source.fallbackSrc} /> : null}
      </audio>
      <button
        type="button"
        aria-label={text ? undefined : label}
        aria-pressed={playing}
        onClick={() => {
          const element = audioRef.current;
          if (!element) return;
          if (playing) {
            element.pause();
            return;
          }
          element.currentTime = 0;
          void element.play().catch(() => setPlaying(false));
        }}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full transition-colors",
          text
            ? "h-11 gap-2 border border-input bg-card px-4 text-[0.95rem] font-bold text-foreground hover:bg-secondary"
            : "size-11 bg-primary-soft text-primary hover:bg-primary hover:text-primary-foreground",
          className,
        )}
      >
        {playing ? (
          <Pause className="size-[18px]" aria-hidden />
        ) : (
          <Play className="size-[18px] fill-current" aria-hidden />
        )}
        {text}
      </button>
    </>
  );
}
