import { describe, expect, it } from "vitest";
import {
  assistResultSchema,
  generationResultSchema,
  locateBlank,
  toolSchemaFor,
} from "@/lib/ai/schemas";
import { buildGenerationPrompt } from "@/lib/ai/prompts";

/**
 * The validation layer.
 *
 * Everything the model says passes through here, and the tests are written
 * from the same premise as the schema: a proposal that is subtly wrong is
 * worse than a proposal that is missing.
 */
describe("the generation schema", () => {
  it("accepts a well-formed batch and fills in the defaults", () => {
    const parsed = generationResultSchema.parse({
      lexemes: [{ slovene: "kruh", german: ["Brot"], partOfSpeech: "noun", gender: "m" }],
      phrases: [{ slovene: "Rada bi kavo, prosim.", german: "Ich hätte gern einen Kaffee." }],
    });

    expect(parsed.lexemes[0]?.register).toBe("standard");
    expect(parsed.phrases[0]?.difficulty).toBe(2);
  });

  it("rejects a part of speech it does not know", () => {
    const result = generationResultSchema.safeParse({
      lexemes: [{ slovene: "kruh", german: ["Brot"], partOfSpeech: "substantiv" }],
    });
    expect(result.success).toBe(false);
  });

  /** An empty gloss would be a card with nothing on the back of it. */
  it("rejects a word with no German at all", () => {
    const result = generationResultSchema.safeParse({
      lexemes: [{ slovene: "kruh", german: [], partOfSpeech: "noun" }],
    });
    expect(result.success).toBe(false);
  });

  it("keeps the dual as a possible cloze target", () => {
    const parsed = generationResultSchema.parse({
      phrases: [
        {
          slovene: "Midva greva domov.",
          german: "Wir beide gehen nach Hause.",
          cloze: { blank: "greva", focusNumber: "dual" },
        },
      ],
    });
    expect(parsed.phrases[0]?.cloze?.focusNumber).toBe("dual");
  });

  it("describes itself as JSON Schema for the tool call", () => {
    const schema = toolSchemaFor(generationResultSchema) as {
      type: string;
      properties: Record<string, unknown>;
    };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toContain("phrases");
    expect(Object.keys(schema.properties)).toContain("notes");
  });
});

describe("locating the blank", () => {
  it("finds the word regardless of punctuation and capitalisation", () => {
    expect(locateBlank("Rada bi kavo, prosim.", "Kavo")).toEqual({
      position: 2,
      answer: "kavo",
    });
  });

  it("matches through folded diacritics but stores the phrase's own spelling", () => {
    const found = locateBlank("Grem v šolo.", "solo");
    expect(found).toEqual({ position: 2, answer: "šolo" });
  });

  /**
   * The case that matters: the model names a word that is not in the sentence.
   * Guessing which one it meant is how a wrong ending gets drilled for weeks.
   */
  it("gives up rather than guessing when the word is not there", () => {
    expect(locateBlank("Rada bi kavo.", "čaj")).toBeNull();
  });
});

describe("the assist schema", () => {
  it("keeps a regional label with the register that explains it", () => {
    const parsed = assistResultSchema.parse({
      german: ["Guten Tag"],
      kind: "phrase",
      partOfSpeech: "phrase",
      register: "regional",
      regionLabel: "Štajersko",
    });
    expect(parsed.regionLabel).toBe("Štajersko");
  });

  it("refuses a suggestion with no German in it", () => {
    expect(
      assistResultSchema.safeParse({ german: [], kind: "lexeme", partOfSpeech: "noun" }).success,
    ).toBe(false);
  });
});

describe("the prompt", () => {
  it("passes the teacher's own words through unchanged", () => {
    const prompt = buildGenerationPrompt({
      topic: "beim Essen bei Oma",
      instructions: "eher Umgangssprache",
      kind: "phrases",
      count: 6,
    });
    expect(prompt).toContain("beim Essen bei Oma");
    expect(prompt).toContain("eher Umgangssprache");
    expect(prompt).toContain("phrases only");
  });
});
