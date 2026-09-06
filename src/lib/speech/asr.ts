import { env } from "@/lib/env";

/**
 * Speech recognition behind an interface.
 *
 * Whisper is decent at recognising Slovene words and cannot judge pronunciation
 * — see scoring.ts. Keeping it behind this seam means a better Slovene model
 * can replace it without touching anything the learner sees.
 */
export type TranscriptionRequest = {
  audio: Buffer;
  mimeType: string;
};

export type TranscriptionSegment = {
  start: number;
  end: number;
  text: string;
  avgLogprob: number;
  noSpeechProb: number;
};

export type TranscriptionResult = {
  text: string;
  language: string;
  durationSeconds: number;
  segments: TranscriptionSegment[];
  engine: string;
  model: string;
};

export interface AsrClient {
  readonly engine: string;
  isAvailable(): Promise<boolean>;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

export class AsrUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsrUnavailableError";
  }
}

type WhisperResponse = {
  text?: string;
  language?: string;
  duration?: number;
  model?: string;
  segments?: {
    start: number;
    end: number;
    text: string;
    avg_logprob: number;
    no_speech_prob: number;
  }[];
};

class WhisperClient implements AsrClient {
  readonly engine = "faster-whisper";

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs = 120_000,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(new URL("/health", this.baseUrl), {
        signal: AbortSignal.timeout(5_000),
      });
      // 503 means the model is still downloading: reachable, not yet usable.
      return response.ok;
    } catch {
      return false;
    }
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    let response: Response;
    try {
      response = await fetch(new URL("/transcribe", this.baseUrl), {
        method: "POST",
        headers: { "Content-Type": request.mimeType },
        body: new Uint8Array(request.audio),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AsrUnavailableError(
        `speech recognition unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.status === 503) {
      const detail = (await response.json().catch(() => ({}))) as { error?: string };
      throw new AsrUnavailableError(detail.error ?? "speech recognition is still starting up");
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`whisper returned ${response.status}: ${detail.slice(0, 300)}`);
    }

    const payload = (await response.json()) as WhisperResponse;

    return {
      text: (payload.text ?? "").trim(),
      language: payload.language ?? "sl",
      durationSeconds: payload.duration ?? 0,
      segments: (payload.segments ?? []).map((segment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.text,
        avgLogprob: segment.avg_logprob,
        noSpeechProb: segment.no_speech_prob,
      })),
      engine: this.engine,
      model: payload.model ?? this.model,
    };
  }
}

/** Null object for when WHISPER_URL is unset: speaking becomes self-assessment. */
class NoAsrClient implements AsrClient {
  readonly engine = "none";

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async transcribe(): Promise<TranscriptionResult> {
    throw new AsrUnavailableError(
      "no speech recognition service is configured (set WHISPER_URL)",
    );
  }
}

let cached: AsrClient | null = null;

export function getAsrClient(): AsrClient {
  if (cached) return cached;
  const url = env().WHISPER_URL;
  cached = url ? new WhisperClient(url, env().WHISPER_MODEL) : new NoAsrClient();
  return cached;
}

/** Test seam. */
export function setAsrClient(client: AsrClient | null): void {
  cached = client;
}
