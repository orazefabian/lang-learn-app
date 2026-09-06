import { describe, expect, it } from "vitest";
import {
  compareAnswer,
  diffStrings,
  foldDiacritics,
  isAccepted,
  levenshtein,
  normalizeAnswer,
  similarityRatio,
  typoAllowance,
} from "@/lib/answers/compare";

describe("normalisation", () => {
  it("lowercases, trims and drops punctuation", () => {
    expect(normalizeAnswer("  Dober DAN!  ")).toBe("dober dan");
    expect(normalizeAnswer("Kako si?")).toBe("kako si");
  });

  it("collapses runs of whitespace", () => {
    expect(normalizeAnswer("dober    dan")).toBe("dober dan");
  });

  it("keeps diacritics until they are explicitly folded", () => {
    expect(normalizeAnswer("Živjo")).toBe("živjo");
    expect(foldDiacritics("živjo")).toBe("zivjo");
    expect(foldDiacritics("čaščenje")).toBe("cascenje");
  });
});

describe("diacritics on a German keyboard", () => {
  /** She should never lose a card because her phone has no ž key. */
  it("accepts c, s and z in place of č, š and ž", () => {
    for (const [input, target] of [
      ["zivjo", "Živjo"],
      ["hvala lepa", "hvala lepa"],
      ["cez", "čez"],
      ["sest", "šest"],
    ] as const) {
      const result = compareAnswer(input, target);
      expect(result.verdict, `${input} vs ${target}`).toBe("correct");
    }
  });

  it("flags that diacritics were missing, so the correct form can be shown", () => {
    const result = compareAnswer("zivjo", "Živjo");
    expect(result.verdict).toBe("correct");
    expect(result.diacriticsOnly).toBe(true);
    expect(result.target).toBe("Živjo");
  });

  it("does not flag a perfectly spelled answer as diacritic-lenient", () => {
    const result = compareAnswer("Živjo", "Živjo");
    expect(result.verdict).toBe("correct");
    expect(result.diacriticsOnly).toBe(false);
  });

  it("ignores case and trailing punctuation", () => {
    expect(compareAnswer("DOBER DAN!", "Dober dan").verdict).toBe("correct");
  });
});

describe("typo tolerance", () => {
  it("forgives one slip in a medium-length answer", () => {
    const result = compareAnswer("dobet dan", "dober dan");
    expect(result.verdict).toBe("almost");
    expect(result.acceptedWithTypo).toBe(true);
    expect(isAccepted(result.verdict)).toBe(true);
  });

  it("forgives nothing in a very short answer", () => {
    // At four characters a wrong letter is usually a different word: ne / na.
    expect(typoAllowance("ne")).toBe(0);
    expect(compareAnswer("na", "ne").verdict).toBe("wrong");
  });

  it("scales the allowance with length", () => {
    expect(typoAllowance("kruh")).toBe(0);
    expect(typoAllowance("hvala lep")).toBe(1);
    expect(typoAllowance("najlepša hvala")).toBe(2);
  });

  it("rejects an answer that is simply a different word", () => {
    const result = compareAnswer("nasvidenje", "dober dan");
    expect(result.verdict).toBe("wrong");
    expect(result.acceptedWithTypo).toBe(false);
  });

  it("rejects an empty answer against a real target", () => {
    expect(compareAnswer("", "hvala").verdict).toBe("wrong");
  });

  it("treats two empty strings as a match rather than dividing by zero", () => {
    const result = compareAnswer("", "");
    expect(result.verdict).toBe("correct");
    expect(result.similarity).toBe(1);
  });
});

describe("distance and similarity", () => {
  it("computes edit distance correctly", () => {
    expect(levenshtein("kruh", "kruh")).toBe(0);
    expect(levenshtein("kruh", "krug")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("sestra", "sestri")).toBe(1);
  });

  it("returns a similarity between 0 and 1", () => {
    expect(similarityRatio("kruh", "kruh")).toBe(1);
    expect(similarityRatio("kruh", "xxxx")).toBe(0);
    const partial = similarityRatio("dober dan", "dober tag");
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
  });
});

describe("diff for showing what differed", () => {
  it("marks matching text as unchanged", () => {
    expect(diffStrings("hvala", "hvala")).toEqual([{ kind: "same", text: "hvala" }]);
  });

  it("marks a missing character as removed", () => {
    const segments = diffStrings("hvala", "hvla");
    expect(segments.some((s) => s.kind === "removed" && s.text === "a")).toBe(true);
    expect(segments.map((s) => s.text).join("")).toContain("hv");
  });

  it("reconstructs the target from same and removed segments", () => {
    const target = "dober dan";
    const segments = diffStrings(target, "dobar den");
    const reconstructed = segments
      .filter((s) => s.kind !== "added")
      .map((s) => s.text)
      .join("");
    expect(reconstructed).toBe(target);
  });

  it("reconstructs the actual answer from same and added segments", () => {
    const actual = "dobar den";
    const segments = diffStrings("dober dan", actual);
    const reconstructed = segments
      .filter((s) => s.kind !== "removed")
      .map((s) => s.text)
      .join("");
    expect(reconstructed).toBe(actual);
  });
});
