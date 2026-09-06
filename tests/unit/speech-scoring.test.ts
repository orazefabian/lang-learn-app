import { describe, expect, it } from "vitest";
import {
  charSimilarity,
  diffWords,
  scoreSpeech,
  toWords,
  wordSimilarity,
} from "@/lib/speech/scoring";

/**
 * These tests encode a judgement, not just arithmetic: the scorer must be
 * forgiving. A beginner speaking a low-resource language into a phone will be
 * misheard often, and a strict threshold would measure the recogniser rather
 * than her.
 */

describe("word similarity", () => {
  it("is 1 for an exact match", () => {
    expect(wordSimilarity("Dober dan", "Dober dan")).toBe(1);
  });

  it("ignores case and punctuation", () => {
    expect(wordSimilarity("Dober dan!", "dober dan")).toBe(1);
  });

  /** Whisper drops diacritics constantly; that is its problem, not hers. */
  it("ignores diacritics", () => {
    expect(wordSimilarity("Živjo, kako si?", "Zivjo, kako si")).toBe(1);
  });

  it("falls off with each wrong word", () => {
    const oneWrong = wordSimilarity("Dober dan gospa", "Dober dan gospod");
    const twoWrong = wordSimilarity("Dober dan gospa", "Lep dan gospod");
    expect(oneWrong).toBeCloseTo(2 / 3, 5);
    expect(twoWrong).toBeLessThan(oneWrong);
  });

  it("penalises a missing word", () => {
    expect(wordSimilarity("Rada bi kavo", "Rada kavo")).toBeCloseTo(2 / 3, 5);
  });

  it("is 0 when one side is empty", () => {
    expect(wordSimilarity("Dober dan", "")).toBe(0);
    expect(wordSimilarity("", "Dober dan")).toBe(0);
  });

  it("treats two empty strings as equal rather than dividing by zero", () => {
    expect(wordSimilarity("", "")).toBe(1);
  });

  it("does not confuse repeated words with different ones", () => {
    expect(wordSimilarity("ne ne", "ne ne")).toBe(1);
    expect(wordSimilarity("ne ne", "ne da")).toBeCloseTo(0.5, 5);
  });
});

describe("character similarity", () => {
  it("rewards near-misses more than nonsense", () => {
    const near = charSimilarity("nasvidenje", "nasvidenja");
    const nonsense = charSimilarity("nasvidenje", "krompir");
    expect(near).toBeGreaterThan(0.85);
    expect(nonsense).toBeLessThan(0.4);
  });

  it("is 1 for a diacritic-only difference", () => {
    expect(charSimilarity("Živjo", "Zivjo")).toBe(1);
  });
});

describe("bands", () => {
  it("calls a clean match good", () => {
    const score = scoreSpeech("Dober dan, kako si?", "Dober dan, kako si?");
    expect(score.band).toBe("good");
    expect(score.suggestedRating).toBe("good");
    expect(score.empty).toBe(false);
  });

  it("still calls a match good when only diacritics differ", () => {
    const score = scoreSpeech("Živjo, kako si?", "Zivjo, kako si");
    expect(score.band).toBe("good");
    expect(score.diacriticsOnly).toBe(true);
  });

  it("calls one wrong word in a longer phrase close, not off", () => {
    const score = scoreSpeech("Rada bi kavo, prosim", "Rada bi kave, prosim");
    expect(score.band).toBe("close");
    expect(score.suggestedRating).toBe("hard");
  });

  it("calls an unrelated utterance off", () => {
    const score = scoreSpeech("Dober dan", "krompir in solata");
    expect(score.band).toBe("off");
    expect(score.suggestedRating).toBe("again");
  });

  /** Silence is usually a microphone problem, not a memory problem. */
  it("reports an empty transcript rather than scoring it as failure", () => {
    const score = scoreSpeech("Dober dan", "   ");
    expect(score.empty).toBe(true);
    expect(score.band).toBe("off");
    expect(score.charSimilarity).toBe(0);
  });

  it("never suggests a rating she cannot change", () => {
    // Every band maps onto one of the four buttons she taps herself.
    for (const transcript of ["Dober dan", "Dober dank", "nekaj drugega", ""]) {
      const score = scoreSpeech("Dober dan", transcript);
      expect(["again", "hard", "good", "easy"]).toContain(score.suggestedRating);
    }
  });

  it("keeps similarities inside 0..1", () => {
    for (const transcript of ["Dober dan", "", "x", "Dober dan dan dan dan"]) {
      const score = scoreSpeech("Dober dan", transcript);
      expect(score.charSimilarity).toBeGreaterThanOrEqual(0);
      expect(score.charSimilarity).toBeLessThanOrEqual(1);
      expect(score.wordSimilarity).toBeGreaterThanOrEqual(0);
      expect(score.wordSimilarity).toBeLessThanOrEqual(1);
    }
  });
});

describe("word diff for the visual comparison", () => {
  it("marks everything as matching when it matches", () => {
    const diff = diffWords("Dober dan", "Dober dan");
    expect(diff.every((segment) => segment.kind === "same")).toBe(true);
  });

  it("marks a word she was expected to say but that was not heard", () => {
    const diff = diffWords("Rada bi kavo", "Rada kavo");
    expect(diff.find((segment) => segment.kind === "missing")?.text).toBe("bi");
  });

  it("marks a word that was heard but not expected", () => {
    const diff = diffWords("Rada kavo", "Rada bi kavo");
    expect(diff.find((segment) => segment.kind === "extra")?.text).toBe("bi");
  });

  it("keeps the target readable from the same and missing segments", () => {
    const diff = diffWords("Dober dan gospa", "Lep dan gospod");
    const target = diff
      .filter((segment) => segment.kind !== "extra")
      .map((segment) => segment.text)
      .join(" ");
    expect(target).toBe("dober dan gospa");
  });

  it("shows the target's spelling, not the transcript's, for matching words", () => {
    // She should see č, š and ž even when the recogniser dropped them.
    const diff = diffWords("Živjo", "Zivjo");
    expect(diff).toEqual([{ kind: "same", text: "živjo" }]);
  });

  it("handles an empty transcript by marking everything missing", () => {
    const diff = diffWords("Dober dan", "");
    expect(diff).toEqual([
      { kind: "missing", text: "dober" },
      { kind: "missing", text: "dan" },
    ]);
  });
});

describe("tokenisation", () => {
  it("splits on whitespace and drops punctuation", () => {
    expect(toWords("Dober dan, kako si?")).toEqual(["dober", "dan", "kako", "si"]);
  });

  it("returns nothing for an empty string", () => {
    expect(toWords("   ")).toEqual([]);
  });
});
