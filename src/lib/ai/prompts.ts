/**
 * What the model is told.
 *
 * This prompt carries the same priorities as the rest of the app: things she
 * could say out loud, to a real person, in the Slovene that family actually
 * speaks. It also says plainly that being unsure is allowed — a flagged doubt
 * costs the teacher ten seconds, a confident wrong ending costs six weeks of
 * drilling.
 */

export const GENERATION_SYSTEM = `You write learning material for one specific beginner: a German native speaker learning Slovene so she can talk with her partner's Slovene-speaking family. She is an absolute beginner. She is not studying for an exam.

Priorities, in order: speaking and pronunciation, then listening, then reading and vocabulary, then grammar. Every phrase you propose must be something she could say out loud to a person — not a textbook example sentence, not a description of a situation.

Rules:
- Slovene must be correct and idiomatic. Use the dual where a Slovene speaker would use it, not to show it off.
- German translations are for a native German speaker: natural German, not word-for-word glosses.
- The context note says when and to whom you say this. Write it in German, concretely ("beim Abschied, wenn du gehst und die anderen bleiben"). Leave it out rather than padding it.
- Grammar is practised through phrases, never as a table. If a phrase is a good place to practise a case ending, mark one word as the cloze blank and say in German what it is testing.
- Mark register honestly. If a form is colloquial or regional, say so instead of quietly proposing it as standard.
- If you are unsure about a form, an ending, or how common something really is, do not guess silently: leave it out or say so in the notes field. Everything you write is reviewed by a native speaker before she ever sees it, and a flagged doubt is cheap.`;

export type GenerationPromptInput = {
  topic: string;
  instructions?: string;
  kind: "mixed" | "phrases" | "lexemes" | "cloze";
  count: number;
};

const KIND_LINES: Record<GenerationPromptInput["kind"], string> = {
  mixed: "Propose a mix of phrases and single words, weighted towards phrases.",
  phrases: "Propose phrases only. Leave the lexemes array empty.",
  lexemes: "Propose single words only. Leave the phrases array empty.",
  cloze:
    "Propose phrases only, and give every one of them a cloze blank on the word that carries the grammar being practised.",
};

export function buildGenerationPrompt(input: GenerationPromptInput): string {
  const lines = [
    `Topic or situation: ${input.topic}`,
    `Roughly how many items: ${input.count}`,
    KIND_LINES[input.kind],
  ];
  if (input.instructions?.trim()) {
    lines.push(`Additional instructions from the teacher: ${input.instructions.trim()}`);
  }
  return lines.join("\n");
}

export const ASSIST_SYSTEM = `A native Slovene speaker has just written down something he heard, usually at a family table, and wants the rest of the entry filled in. Given the Slovene, propose the German translation and the grammatical details.

These are suggestions he will read and correct, so be accurate rather than complete: leave a field out when you are not sure. Mark colloquial and regional forms as what they are — the point of the entry is usually that it is how the family really talks, not how a textbook would put it.`;

export function buildAssistPrompt(slovene: string, hint?: string): string {
  return hint?.trim()
    ? `Slovene: ${slovene}\nWhat the teacher already noted: ${hint.trim()}`
    : `Slovene: ${slovene}`;
}
