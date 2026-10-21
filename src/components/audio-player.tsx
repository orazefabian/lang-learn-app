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
  /** A separately rendered slow version, when the engine produced one. */
  slowSrc: string | null;
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
  const slowRef = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Set when the next source change came from her tapping a voice. */
  const playOnLoad = useRef(false);

  /*
   * Reset to the first voice when the sources themselves change. Without this a
   * card offering one voice, reached from a card where she had selected the
   * second, would find nothing at `index` and report itself unavailable.
   */
  const sourceIds = sources.map((source) => source.id).join("|");
  const [knownSourceIds, setKnownSourceIds] = useState(sourceIds);
  if (sourceIds !== knownSourceIds) {
    setKnownSourceIds(sourceIds);
    setIndex(0);
  }

  const current = sources[index] ?? sources[0];

  const play = useCallback(async (rate = 1) => {
    const element = audioRef.current;
    if (!element) return;
    // Never two voices at once.
    slowRef.current?.pause();
    element.playbackRate = rate;
    element.currentTime = 0;
    try {
      await element.play();
    } catch {
      // Autoplay policy, or no audio to play. Either way the button still works.
      setPlaying(false);
    }
  }, []);

  /**
   * The turtle button.
   *
   * A separately rendered slow copy when there is one — the synthesiser
   * lengthens the vowels, where `playbackRate` stretches the silences too.
   * Human recordings have no such copy, so they are slowed in the player as
   * before.
   */
  const playSlow = useCallback(async () => {
    const element = slowRef.current;
    if (!element) {
      void play(0.75);
      return;
    }
    audioRef.current?.pause();
    element.currentTime = 0;
    try {
      await element.play();
    } catch {
      void play(0.75);
    }
  }, [play]);

  const src = current?.src ?? "";
  const fallbackSrc = current?.fallbackSrc ?? "";
  const slowSrc = current?.slowSrc ?? "";

  useEffect(() => {
    const element = audioRef.current;
    if (!element || !src) return;

    setFailed(false);
    /*
     * A media element resolves its `<source>` children once and then holds on
     * to what it loaded. React updates the attributes when the card or the
     * voice changes, but without this the element would keep playing the first
     * clip it ever loaded — the next item's audio would be the previous one's.
     */
    element.load();
    // Same contract for the slow copy, which is a media element of its own.
    slowRef.current?.load();

    const requested = playOnLoad.current;
    playOnLoad.current = false;
    if (autoplay || requested) void play();
  }, [autoplay, fallbackSrc, play, slowSrc, src]);

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

      {current.slowSrc ? (
        <audio ref={slowRef} preload="none" src={current.slowSrc} />
      ) : null}

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
          onClick={() => void playSlow()}
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
                // Re-tapping the selected voice is a replay; a new voice has to
                // wait for the element to load it, which the effect handles.
                if (position === index) {
                  void play();
                  return;
                }
                playOnLoad.current = true;
                setIndex(position);
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
