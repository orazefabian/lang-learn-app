/**
 * Answer comparison for typed exercises.
 *
 * Two rules from the brief drive everything here:
 *
 *  - Diacritics must be easy on a German phone keyboard. Typing `c`, `s` or `z`
 *    for č, š or ž counts as correct — but the correct spelling is always shown
 *    back, so she learns it without being punished for her keyboard.
 *  - Minor typos are accepted. Being marked wrong for a slipped finger teaches
 *    nothing and costs motivation.
 */

export type AnswerVerdict = "correct" | "almost" | "wrong";

export type AnswerComparison = {
  verdict: AnswerVerdict;
  /** The expected answer, exactly as it should be written. */
  target: string;
  input: string;
  /** 0..1, character-level similarity of the folded strings. */
  similarity: number;
  editDistance: number;
  /** True when the only difference was missing or wrong diacritics. */
  diacriticsOnly: boolean;
  /** True when it was accepted despite not being character-perfect. */
  acceptedWithTypo: boolean;
};

/** Lowercase, collapse whitespace, drop punctuation. Keeps diacritics. */
export function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,!?;:"„“”«»…]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Additionally folds č→c, š→s, ž→z and any other combining accents. */
export function foldDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = (current[j - 1] as number) + 1;
      const deletion = (previous[j] as number) + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length] as number;
}

/** 1 for identical strings, 0 for nothing in common. */
export function similarityRatio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * How many single-character slips to forgive. Short answers get none — at three
 * characters, one wrong letter is usually a different word.
 */
export function typoAllowance(target: string): number {
  if (target.length <= 4) return 0;
  if (target.length <= 9) return 1;
  return 2;
}

export function compareAnswer(input: string, target: string): AnswerComparison {
  const normalizedInput = normalizeAnswer(input);
  const normalizedTarget = normalizeAnswer(target);

  const foldedInput = foldDiacritics(normalizedInput);
  const foldedTarget = foldDiacritics(normalizedTarget);

  const editDistance = levenshtein(foldedInput, foldedTarget);
  const similarity = similarityRatio(foldedInput, foldedTarget);

  const exact = normalizedInput === normalizedTarget;
  const foldedMatch = foldedInput === foldedTarget;
  const diacriticsOnly = foldedMatch && !exact;

  if (exact || foldedMatch) {
    return {
      verdict: "correct",
      target,
      input,
      similarity: 1,
      editDistance: 0,
      diacriticsOnly,
      acceptedWithTypo: false,
    };
  }

  const withinTypoBudget = editDistance <= typoAllowance(foldedTarget);
  return {
    verdict: withinTypoBudget ? "almost" : "wrong",
    target,
    input,
    similarity,
    editDistance,
    diacriticsOnly: false,
    acceptedWithTypo: withinTypoBudget,
  };
}

/** "almost" still counts as knowing it; the correct spelling is shown alongside. */
export function isAccepted(verdict: AnswerVerdict): boolean {
  return verdict !== "wrong";
}

export type DiffSegment = { kind: "same" | "added" | "removed"; text: string };

/**
 * Character-level diff for showing what differed. Used by the typed exercises
 * and, later, by speech scoring to show target against transcript.
 */
export function diffStrings(target: string, actual: string): DiffSegment[] {
  const a = [...target];
  const b = [...actual];

  // Standard edit-distance table, then walk it backwards for the alignment.
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i += 1) (table[i] as number[])[0] = i;
  for (let j = 0; j <= b.length; j += 1) (table[0] as number[])[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      (table[i] as number[])[j] = Math.min(
        ((table[i - 1] as number[])[j] as number) + 1,
        ((table[i] as number[])[j - 1] as number) + 1,
        ((table[i - 1] as number[])[j - 1] as number) + cost,
      );
    }
  }

  const segments: DiffSegment[] = [];
  let i = a.length;
  let j = b.length;

  const push = (kind: DiffSegment["kind"], text: string) => {
    const last = segments[0];
    if (last && last.kind === kind) last.text = text + last.text;
    else segments.unshift({ kind, text });
  };

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      push("same", a[i - 1] as string);
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || ((table[i] as number[])[j - 1] as number) <= ((table[i - 1] as number[])[j] as number))) {
      push("added", b[j - 1] as string);
      j -= 1;
    } else if (i > 0) {
      push("removed", a[i - 1] as string);
      i -= 1;
    }
  }

  return segments;
}
