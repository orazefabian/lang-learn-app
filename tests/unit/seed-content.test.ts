import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  curriculumFileSchema,
  frequencyLexemeFileSchema,
  frequencyWordFormFileSchema,
  normalizeSlovene,
  stripPunctuation,
  tokenizePhrase,
} from "@/lib/seed/schemas";
import { validateCloze } from "@/lib/seed/import";

/**
 * The seed files are content, and content is where mistakes hide. These tests
 * are the boundary check the spec asks for: no seed file reaches the database
 * without passing them.
 */
const SEED = path.join(process.cwd(), "seed");

async function curriculumFiles() {
  const dir = path.join(SEED, "curriculum");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      raw: JSON.parse(await readFile(path.join(dir, name), "utf8")),
    })),
  );
}

describe("curriculum seed files", () => {
  it("all validate against the schema", async () => {
    const files = await curriculumFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const { name, raw } of files) {
      const result = curriculumFileSchema.safeParse(raw);
      if (!result.success) {
        throw new Error(`${name}: ${JSON.stringify(result.error.issues, null, 2)}`);
      }
    }
  });

  it("covers 30–40 lessons as the course design calls for", async () => {
    const files = await curriculumFiles();
    const total = files.reduce(
      (sum, { raw }) => sum + curriculumFileSchema.parse(raw).lessons.length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(30);
    expect(total).toBeLessThanOrEqual(40);
  });

  it("has unique lesson and unit slugs across all files", async () => {
    const files = await curriculumFiles();
    const lessonSlugs: string[] = [];
    const unitSlugs: string[] = [];
    for (const { raw } of files) {
      const file = curriculumFileSchema.parse(raw);
      unitSlugs.push(file.unit.slug);
      for (const lesson of file.lessons) lessonSlugs.push(lesson.slug);
    }
    expect(new Set(lessonSlugs).size).toBe(lessonSlugs.length);
    expect(new Set(unitSlugs).size).toBe(unitSlugs.length);
  });

  it("points every cloze blank at the token it claims", async () => {
    const files = await curriculumFiles();
    for (const { name, raw } of files) {
      validateCloze(curriculumFileSchema.parse(raw), name);
    }
  });

  it("references only grammar notes that exist somewhere in the curriculum", async () => {
    const files = await curriculumFiles();
    const defined = new Set<string>();
    const referenced: { slug: string; lesson: string }[] = [];
    for (const { raw } of files) {
      const file = curriculumFileSchema.parse(raw);
      for (const note of file.grammarNotes) defined.add(note.slug);
      for (const lesson of file.lessons) {
        for (const slug of lesson.grammarNoteSlugs) referenced.push({ slug, lesson: lesson.slug });
      }
    }
    const missing = referenced.filter((r) => !defined.has(r.slug));
    expect(missing, `unknown grammar notes: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it("teaches the dual — it is the reason this app exists", async () => {
    const files = await curriculumFiles();
    const items = files.flatMap(({ raw }) =>
      curriculumFileSchema.parse(raw).lessons.flatMap((l) => l.items),
    );
    const dualTagged = items.filter((i) => i.tags.includes("dvojina"));
    expect(dualTagged.length).toBeGreaterThanOrEqual(8);

    const dualCloze = items.filter(
      (i) => i.kind === "phrase" && i.cloze.some((c) => c.focusNumber === "dual"),
    );
    expect(dualCloze.length).toBeGreaterThanOrEqual(3);
  });

  it("introduces cases in conversational order, accusative before genitive", async () => {
    const files = await curriculumFiles();
    const firstAt = new Map<string, number>();
    let position = 0;
    for (const { raw } of files) {
      const file = curriculumFileSchema.parse(raw);
      for (const lesson of [...file.lessons].sort((a, b) => a.position - b.position)) {
        position += 1;
        for (const item of lesson.items) {
          if (item.kind !== "phrase") continue;
          for (const cloze of item.cloze) {
            if (cloze.focusCase && !firstAt.has(cloze.focusCase)) {
              firstAt.set(cloze.focusCase, position);
            }
          }
        }
      }
    }
    const accusative = firstAt.get("accusative");
    const genitive = firstAt.get("genitive");
    expect(accusative).toBeDefined();
    if (accusative !== undefined && genitive !== undefined) {
      expect(accusative).toBeLessThanOrEqual(genitive);
    }
  });
});

describe("frequency deck", () => {
  it("validates against the schema and is ranked without gaps", async () => {
    const raw = JSON.parse(await readFile(path.join(SEED, "frequency-lexemes.json"), "utf8"));
    const file = frequencyLexemeFileSchema.parse(raw);
    expect(file.lexemes.length).toBeGreaterThanOrEqual(800);
    expect(file.lexemes.length).toBeLessThanOrEqual(1200);
    file.lexemes.forEach((lexeme, index) => {
      expect(lexeme.frequencyRank).toBe(index + 1);
    });
  });

  it("has no duplicate headwords", async () => {
    const raw = JSON.parse(await readFile(path.join(SEED, "frequency-lexemes.json"), "utf8"));
    const file = frequencyLexemeFileSchema.parse(raw);
    const seen = new Set(file.lexemes.map((l) => `${l.sloveneNormalized}|${l.partOfSpeech}`));
    expect(seen.size).toBe(file.lexemes.length);
  });

  it("carries dual forms for nouns", async () => {
    const raw = JSON.parse(await readFile(path.join(SEED, "frequency-word-forms.json"), "utf8"));
    const file = frequencyWordFormFileSchema.parse(raw);
    const duals = file.wordForms.filter((f) => f.number === "dual");
    expect(duals.length).toBeGreaterThan(500);
    expect(duals.some((f) => f.grammaticalCase === "nominative")).toBe(true);
  });

  it("normalises forms consistently with the app", async () => {
    const raw = JSON.parse(await readFile(path.join(SEED, "frequency-word-forms.json"), "utf8"));
    const file = frequencyWordFormFileSchema.parse(raw);
    for (const form of file.wordForms.slice(0, 500)) {
      expect(form.formNormalized).toBe(
        normalizeSlovene(form.form).replace(/[^a-z0-9' -]/g, ""),
      );
    }
  });
});

describe("tokenisation", () => {
  it("counts tokens the way cloze positions do", () => {
    expect(tokenizePhrase("Imam dve sestri.")).toEqual(["Imam", "dve", "sestri."]);
    expect(stripPunctuation("sestri.")).toBe("sestri");
    expect(stripPunctuation("»Živjo!«")).toBe("Živjo");
  });

  it("folds diacritics but keeps the letters", () => {
    expect(normalizeSlovene("Čaščenje")).toBe("cascenje");
    expect(normalizeSlovene("ŽELIM")).toBe("zelim");
  });
});
