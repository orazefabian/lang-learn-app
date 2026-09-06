import { z } from "zod";
import { normalizeSlovene } from "@/lib/seed/schemas";

/**
 * The shape the model must produce, and the only door into the database.
 *
 * Slovene grammar is easy to get subtly wrong, and a wrong case ending drilled
 * for six weeks is worse than no card at all. So the schema is strict, the
 * enums are closed, and anything that fails validation is dropped with a note
 * rather than repaired — a silently repaired ending is exactly the failure we
 * are trying to avoid.
 */

export const partOfSpeechValues = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "numeral",
  "preposition",
  "conjunction",
  "particle",
  "interjection",
  "phrase",
  "other",
] as const;

export const caseValues = [
  "nominative",
  "accusative",
  "locative",
  "genitive",
  "dative",
  "instrumental",
] as const;

export const numberValues = ["singular", "dual", "plural"] as const;
export const registerValues = ["standard", "colloquial", "regional", "formal"] as const;

export const proposedLexemeSchema = z.object({
  slovene: z
    .string()
    .min(1)
    .max(80)
    .describe("The dictionary form: nominative singular for nouns, infinitive for verbs."),
  german: z
    .array(z.string().min(1).max(120))
    .min(1)
    .max(4)
    .describe("German translations, most common first."),
  partOfSpeech: z.enum(partOfSpeechValues),
  gender: z.enum(["m", "f", "n"]).optional().describe("Nouns only."),
  aspect: z
    .enum(["perfective", "imperfective", "biaspectual"])
    .optional()
    .describe("Verbs only."),
  register: z.enum(registerValues).default("standard"),
  difficulty: z.number().int().min(1).max(5).default(2),
  notes: z
    .string()
    .max(400)
    .optional()
    .describe("A short note in German if the word needs one. Usually leave this out."),
});

export const proposedClozeSchema = z.object({
  blank: z
    .string()
    .min(1)
    .max(40)
    .describe(
      "One word from the phrase, spelled exactly as it appears there, which the learner has to supply.",
    ),
  focusCase: z.enum(caseValues).optional(),
  focusNumber: z.enum(numberValues).optional(),
  hintDe: z
    .string()
    .max(160)
    .optional()
    .describe('A short German nudge, e.g. "wohin? → Akkusativ".'),
});

export const proposedPhraseSchema = z.object({
  slovene: z.string().min(1).max(200).describe("Something she could say out loud to a person."),
  german: z.string().min(1).max(200),
  contextNote: z
    .string()
    .max(400)
    .optional()
    .describe("In German: when and to whom you say this. This is what makes it stick."),
  register: z.enum(registerValues).default("standard"),
  difficulty: z.number().int().min(1).max(5).default(2),
  cloze: proposedClozeSchema
    .optional()
    .describe("Optional: one word to blank out, to practise a case or verb ending."),
});

export const generationResultSchema = z.object({
  lexemes: z.array(proposedLexemeSchema).max(40).default([]),
  phrases: z.array(proposedPhraseSchema).max(40).default([]),
  notes: z
    .string()
    .max(800)
    .optional()
    .describe(
      "Anything the teacher should double-check: regional variants, register, a form you are unsure about.",
    ),
});

export type ProposedLexeme = z.infer<typeof proposedLexemeSchema>;
export type ProposedPhrase = z.infer<typeof proposedPhraseSchema>;
export type GenerationResult = z.infer<typeof generationResultSchema>;

export const assistResultSchema = z.object({
  german: z.array(z.string().min(1).max(120)).min(1).max(4),
  kind: z.enum(["phrase", "lexeme"]),
  partOfSpeech: z.enum(partOfSpeechValues),
  gender: z.enum(["m", "f", "n"]).optional(),
  aspect: z.enum(["perfective", "imperfective", "biaspectual"]).optional(),
  register: z.enum(registerValues).default("standard"),
  regionLabel: z.string().max(80).optional(),
  contextNote: z.string().max(400).optional(),
  grammarNote: z
    .string()
    .max(400)
    .optional()
    .describe("One line in German about the form, if it is worth saying."),
});

export type AssistResult = z.infer<typeof assistResultSchema>;

/** The JSON Schema handed to the model, derived from the Zod schema itself. */
export function toolSchemaFor(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
}

const PUNCTUATION = /[.,!?;:"'„“”()¿¡…—–]/g;

export function stripPunctuation(token: string): string {
  return token.replace(PUNCTUATION, "");
}

/**
 * Finds the blanked word in the phrase.
 *
 * The model is told to copy the word exactly, and mostly does, but "exactly"
 * has to survive punctuation and capitalisation at the start of a sentence.
 * Matching is done on the folded form so *Kavo* finds *kavo* — but the answer
 * stored is the phrase's own spelling, never the model's copy of it.
 */
export function locateBlank(
  slovene: string,
  blank: string,
): { position: number; answer: string } | null {
  const target = normalizeSlovene(stripPunctuation(blank));
  if (!target) return null;

  const tokens = slovene.split(/\s+/).filter(Boolean);
  for (const [index, token] of tokens.entries()) {
    const bare = stripPunctuation(token);
    if (normalizeSlovene(bare) === target) {
      return { position: index, answer: bare };
    }
  }
  return null;
}
