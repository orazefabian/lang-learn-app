import { env } from "@/lib/env";

/**
 * Text-to-speech behind an interface, so a better Slovene voice can replace
 * Piper without the rest of the app noticing.
 */
export type AudioFormat = "opus" | "mp3" | "wav";

export type SynthesisRequest = {
  text: string;
  format: AudioFormat;
  /** Piper voice id; defaults to PIPER_VOICE. */
  voice?: string;
  /** Above 1 is slower. The 0.75x button in the UI is player-side, not this. */
  lengthScale?: number;
};

export type SynthesisResult = {
  audio: Buffer;
  mimeType: string;
  voice: string;
};

export interface TtsClient {
  readonly engine: string;
  isAvailable(): Promise<boolean>;
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>;
}

const MIME_TYPES: Record<AudioFormat, string> = {
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

export function mimeTypeFor(format: AudioFormat): string {
  return MIME_TYPES[format];
}

export class TtsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsUnavailableError";
  }
}

class PiperClient implements TtsClient {
  readonly engine = "piper";

  constructor(
    private readonly baseUrl: string,
    private readonly defaultVoice: string,
    private readonly timeoutMs = 60_000,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(new URL("/health", this.baseUrl), {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const voice = request.voice ?? this.defaultVoice;

    const response = await fetch(new URL("/synthesize", this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: request.text,
        format: request.format,
        voice,
        ...(request.lengthScale ? { length_scale: request.lengthScale } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`piper returned ${response.status}: ${detail.slice(0, 300)}`);
    }

    return {
      audio: Buffer.from(await response.arrayBuffer()),
      mimeType: mimeTypeFor(request.format),
      voice,
    };
  }
}

/** Null object used when PIPER_URL is unset: audio features simply go quiet. */
class NoTtsClient implements TtsClient {
  readonly engine = "none";

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async synthesize(): Promise<SynthesisResult> {
    throw new TtsUnavailableError("no text-to-speech service is configured (set PIPER_URL)");
  }
}

let cached: TtsClient | null = null;

export function getTtsClient(): TtsClient {
  if (cached) return cached;
  const url = env().PIPER_URL;
  cached = url ? new PiperClient(url, env().PIPER_VOICE) : new NoTtsClient();
  return cached;
}

/** Test seam. */
export function setTtsClient(client: TtsClient | null): void {
  cached = client;
}
