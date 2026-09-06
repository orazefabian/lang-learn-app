import { foldDiacritics, levenshtein, normalizeAnswer } from "@/lib/answers/compare";
import type { CardRating } from "@/lib/srs/scheduler";

/**
 * Scoring a spoken attempt.
 *
 * Be clear about what this is. Whisper recognises words; it cannot judge
 * pronunciation, vowel length or pitch accent. What comes out of here is
 * "the recogniser understood these words", not "you said it correctly" — the
 * UI frames it as *verstanden als: …* for exactly that reason, and she can
 * always overrule it.
 *
 * The score therefore feeds a *suggested* rating. She taps the rating herself,
 * so a misheard word costs her nothing.
 */

export type SpeechBand = "good" | "close" | "off";

export type SpeechScore = {
  band: SpeechBand;
  /** Character-level similarity of the folded strings, 0..1. */
  charSimilarity: number;
  /** Word-level similarity, 0..1. */
  wordSimilarity: number;
  /** What we would suggest; never applied without her tap. */
  suggestedRating: CardRating;
  /** True when the recogniser heard nothing at all. */
  empty: boolean;
  /** True when the only differences were diacritics — a transcription artefact. */
  diacriticsOnly: boolean;
};

/**
 * Thresholds are deliberately forgiving. A beginner speaking a low-resource
 * language into a phone microphone will be misheard often, and a strict
 * threshold would mostly measure the recogniser, not her.
 */
const GOOD_CHAR = 0.85;
/**
 * One wrong word in a four-word phrase lands at 0.75, and that should read as
 * "close", not "good" — in Slovene the differing word is usually a case ending
 * (*kavo* against *kave*), which is exactly what the cloze exercises are for.
 * Longer phrases stay forgiving: one wrong word in five still passes.
 */
const GOOD_WORD = 0.8;
const CLOSE_CHAR = 0.6;

export function normalizeForSpeech(value: string): string {
  return normalizeAnswer(value);
}

export function toWords(value: string): string[] {
  const normalized = normalizeForSpeech(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

/** Levenshtein over words rather than characters, expressed as a ratio. */
export function wordSimilarity(target: string, actual: string): number {
  const a = toWords(foldDiacritics(target));
  const b = toWords(foldDiacritics(actual));
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;

  // Map each distinct word to a character so the character-level routine can
  // do the alignment work.
  const alphabet = new Map<string, string>();
  const encode = (words: string[]) =>
    words
      .map((word) => {
        let symbol = alphabet.get(word);
        if (!symbol) {
          symbol = String.fromCodePoint(0xe000 + alphabet.size);
          alphabet.set(word, symbol);
        }
        return symbol;
      })
      .join("");

  const distance = levenshtein(encode(a), encode(b));
  return 1 - distance / Math.max(a.length, b.length);
}

export function charSimilarity(target: string, actual: string): number {
  const a = foldDiacritics(normalizeForSpeech(target));
  const b = foldDiacritics(normalizeForSpeech(actual));
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

export function scoreSpeech(target: string, transcript: string): SpeechScore {
  const cleanTranscript = normalizeForSpeech(transcript);
  const cleanTarget = normalizeForSpeech(target);

  if (!cleanTranscript) {
    return {
      band: "off",
      charSimilarity: 0,
      wordSimilarity: 0,
      // Nothing was heard, which is usually a microphone problem rather than a
      // memory problem. "Again" is the safe suggestion; she can overrule it.
      suggestedRating: "again",
      empty: true,
      diacriticsOnly: false,
    };
  }

  const chars = charSimilarity(target, transcript);
  const words = wordSimilarity(target, transcript);

  const foldedMatch =
    foldDiacritics(cleanTarget) === foldDiacritics(cleanTranscript) &&
    cleanTarget !== cleanTranscript;

  let band: SpeechBand;
  if (chars >= GOOD_CHAR && words >= GOOD_WORD) band = "good";
  else if (chars >= CLOSE_CHAR) band = "close";
  else band = "off";

  const suggestedRating: CardRating =
    band === "good" ? "good" : band === "close" ? "hard" : "again";

  return {
    band,
    charSimilarity: Number(chars.toFixed(4)),
    wordSimilarity: Number(words.toFixed(4)),
    suggestedRating,
    empty: false,
    diacriticsOnly: foldedMatch,
  };
}

export type WordDiffSegment = {
  kind: "same" | "missing" | "extra";
  /** The word as it appears in the target (missing/same) or transcript (extra). */
  text: string;
};

/**
 * Word-level alignment between what she was asked to say and what the
 * recogniser heard, so the UI can show *what* differed rather than a number.
 */
export function diffWords(target: string, transcript: string): WordDiffSegment[] {
  const a = toWords(target);
  const b = toWords(transcript);

  const foldedA = a.map((word) => foldDiacritics(word));
  const foldedB = b.map((word) => foldDiacritics(word));

  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i += 1) (table[i] as number[])[0] = i;
  for (let j = 0; j <= b.length; j += 1) (table[0] as number[])[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = foldedA[i - 1] === foldedB[j - 1] ? 0 : 1;
      (table[i] as number[])[j] = Math.min(
        ((table[i - 1] as number[])[j] as number) + 1,
        ((table[i] as number[])[j - 1] as number) + 1,
        ((table[i - 1] as number[])[j - 1] as number) + cost,
      );
    }
  }

  const segments: WordDiffSegment[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && foldedA[i - 1] === foldedB[j - 1]) {
      segments.unshift({ kind: "same", text: a[i - 1] as string });
      i -= 1;
      j -= 1;
    } else if (
      j > 0 &&
      (i === 0 ||
        ((table[i] as number[])[j - 1] as number) <= ((table[i - 1] as number[])[j] as number))
    ) {
      segments.unshift({ kind: "extra", text: b[j - 1] as string });
      j -= 1;
    } else if (i > 0) {
      segments.unshift({ kind: "missing", text: a[i - 1] as string });
      i -= 1;
    }
  }

  return segments;
}
