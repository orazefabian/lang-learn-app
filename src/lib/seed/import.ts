import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  clozeItems,
  grammarNoteLinks,
  grammarNotes,
  lessonItems,
  lessons,
  lexemes,
  phraseLexemes,
  phrases,
  units,
  wordForms,
} from "@/db/schema";
import {
  curriculumFileSchema,
  frequencyLexemeFileSchema,
  frequencyWordFormFileSchema,
  normalizeSlovene,
  stripPunctuation,
  tokenizePhrase,
  type CurriculumFile,
} from "./schemas";

export type ImportOptions = {
  db: Db;
  seedDir: string;
  /** Content lands as draft by default; nothing reaches her deck unreviewed. */
  activate?: boolean;
  /** Skip the 1100-lemma frequency deck, e.g. when only curriculum changed. */
  skipFrequencyDeck?: boolean;
  log?: (message: string) => void;
};

export type ImportReport = {
  lexemesInserted: number;
  lexemesSkipped: number;
  wordFormsInserted: number;
  phrasesInserted: number;
  phrasesSkipped: number;
  clozeInserted: number;
  lessonsUpserted: number;
  unitsUpserted: number;
  grammarNotesUpserted: number;
  phraseLexemeLinks: number;
  /** Normalised forms that already existed. Warned about, never silently dropped. */
  duplicates: string[];
};

const CHUNK = 500;

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Checks that every cloze blank actually points at the token it claims to.
 * An off-by-one here would drill a wrong answer for months, so this throws
 * rather than warns.
 */
export function validateCloze(file: CurriculumFile, fileName: string): void {
  for (const lesson of file.lessons) {
    for (const item of lesson.items) {
      if (item.kind !== "phrase") continue;
      const tokens = tokenizePhrase(item.slovene);
      for (const cloze of item.cloze) {
        const token = tokens[cloze.position];
        if (token === undefined) {
          throw new Error(
            `${fileName}: lesson "${lesson.slug}": cloze position ${cloze.position} is past the end of "${item.slovene}"`,
          );
        }
        const actual = normalizeSlovene(stripPunctuation(token));
        const expected = normalizeSlovene(stripPunctuation(cloze.answer));
        if (actual !== expected) {
          throw new Error(
            `${fileName}: lesson "${lesson.slug}": cloze at position ${cloze.position} of "${item.slovene}" is "${token}", but the answer says "${cloze.answer}"`,
          );
        }
      }
    }
  }
}

export async function loadCurriculumFiles(
  seedDir: string,
): Promise<{ file: CurriculumFile; name: string }[]> {
  const dir = path.join(seedDir, "curriculum");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();

  const files: { file: CurriculumFile; name: string }[] = [];
  for (const name of names) {
    const raw = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    const file = curriculumFileSchema.parse(raw);
    validateCloze(file, name);
    files.push({ file, name });
  }
  return files;
}

export async function importSeed(options: ImportOptions): Promise<ImportReport> {
  const { db, seedDir, activate = false } = options;
  const log = options.log ?? (() => {});
  const status = activate ? "active" : "draft";

  const report: ImportReport = {
    lexemesInserted: 0,
    lexemesSkipped: 0,
    wordFormsInserted: 0,
    phrasesInserted: 0,
    phrasesSkipped: 0,
    clozeInserted: 0,
    lessonsUpserted: 0,
    unitsUpserted: 0,
    grammarNotesUpserted: 0,
    phraseLexemeLinks: 0,
    duplicates: [],
  };

  /** Keyed by `${normalized}|${partOfSpeech}` — the dedup key for lexemes. */
  const lexemeIds = new Map<string, string>();
  for (const row of await db
    .select({
      id: lexemes.id,
      normalized: lexemes.sloveneNormalized,
      pos: lexemes.partOfSpeech,
    })
    .from(lexemes)) {
    lexemeIds.set(`${row.normalized}|${row.pos}`, row.id);
  }

  if (!options.skipFrequencyDeck) {
    await importFrequencyDeck(db, seedDir, status, lexemeIds, report, log);
  }

  await importCurriculum(db, seedDir, status, lexemeIds, report, log);
  await linkPhraseLexemes(db, report, log);

  return report;
}

async function importFrequencyDeck(
  db: Db,
  seedDir: string,
  status: "draft" | "active",
  lexemeIds: Map<string, string>,
  report: ImportReport,
  log: (message: string) => void,
): Promise<void> {
  const lexemeFile = frequencyLexemeFileSchema.parse(
    JSON.parse(await readFile(path.join(seedDir, "frequency-lexemes.json"), "utf8")),
  );
  log(`frequency deck: ${lexemeFile.lexemes.length} lemmas`);

  const pending: (typeof lexemes.$inferInsert)[] = [];
  for (const entry of lexemeFile.lexemes) {
    const key = `${entry.sloveneNormalized}|${entry.partOfSpeech}`;
    const existingId = lexemeIds.get(key);
    if (existingId) {
      report.lexemesSkipped += 1;
      report.duplicates.push(entry.slovene);
      // Fill a gap the deck can now cover, but never overwrite a gloss that is
      // already there — that one may be the teacher's own correction.
      if (entry.german.length) {
        await db
          .update(lexemes)
          .set({ german: entry.german, updatedAt: new Date() })
          .where(and(eq(lexemes.id, existingId), eq(sql`jsonb_array_length(${lexemes.german})`, 0)));
      }
      continue;
    }
    // Guard against duplicates inside the file itself, not just against the DB.
    if (pending.some((p) => p.sloveneNormalized === entry.sloveneNormalized && p.partOfSpeech === entry.partOfSpeech)) {
      report.lexemesSkipped += 1;
      report.duplicates.push(entry.slovene);
      continue;
    }
    pending.push({
      slovene: entry.slovene,
      sloveneNormalized: entry.sloveneNormalized,
      german: entry.german,
      partOfSpeech: entry.partOfSpeech,
      gender: entry.gender,
      aspect: entry.aspect,
      frequencyRank: entry.frequencyRank,
      tags: entry.tags,
      source: "seed",
      status,
    });
  }

  for (const batch of chunked(pending)) {
    const inserted = await db
      .insert(lexemes)
      .values(batch)
      .returning({ id: lexemes.id, normalized: lexemes.sloveneNormalized, pos: lexemes.partOfSpeech });
    for (const row of inserted) lexemeIds.set(`${row.normalized}|${row.pos}`, row.id);
    report.lexemesInserted += inserted.length;
  }
  log(`  inserted ${report.lexemesInserted}, skipped ${report.lexemesSkipped} duplicates`);

  const formFile = frequencyWordFormFileSchema.parse(
    JSON.parse(await readFile(path.join(seedDir, "frequency-word-forms.json"), "utf8")),
  );

  const targetIds = [...new Set(formFile.wordForms.map((f) => lexemeIds.get(`${normalizeSlovene(f.lemma)}|${f.partOfSpeech}`)).filter((v): v is string => Boolean(v)))];

  /** Forms already stored, so re-running the import stays a no-op. */
  const existingForms = new Set<string>();
  for (const batch of chunked(targetIds, 200)) {
    for (const row of await db
      .select({ lexemeId: wordForms.lexemeId, form: wordForms.form, msd: wordForms.msd })
      .from(wordForms)
      .where(inArray(wordForms.lexemeId, batch))) {
      existingForms.add(`${row.lexemeId}|${row.form}|${row.msd ?? ""}`);
    }
  }

  const formRows: (typeof wordForms.$inferInsert)[] = [];
  const seenInFile = new Set<string>();
  for (const form of formFile.wordForms) {
    const lexemeId = lexemeIds.get(`${normalizeSlovene(form.lemma)}|${form.partOfSpeech}`);
    if (!lexemeId) continue;
    const key = `${lexemeId}|${form.form}|${form.msd ?? ""}`;
    if (existingForms.has(key) || seenInFile.has(key)) continue;
    seenInFile.add(key);
    formRows.push({
      lexemeId,
      form: form.form,
      formNormalized: form.formNormalized || normalizeSlovene(form.form),
      grammaticalCase: form.grammaticalCase,
      number: form.number,
      gender: form.gender,
      person: form.person,
      verbForm: form.verbForm,
      degree: form.degree,
      definiteness: form.definiteness,
      msd: form.msd,
      source: "seed",
    });
  }

  for (const batch of chunked(formRows)) {
    await db.insert(wordForms).values(batch);
    report.wordFormsInserted += batch.length;
  }
  log(`  inserted ${report.wordFormsInserted} word forms`);
}

async function importCurriculum(
  db: Db,
  seedDir: string,
  status: "draft" | "active",
  lexemeIds: Map<string, string>,
  report: ImportReport,
  log: (message: string) => void,
): Promise<void> {
  const files = await loadCurriculumFiles(seedDir);
  log(`curriculum: ${files.length} units`);

  const phraseIds = new Map<string, string>();
  for (const row of await db
    .select({ id: phrases.id, normalized: phrases.sloveneNormalized })
    .from(phrases)) {
    phraseIds.set(row.normalized, row.id);
  }

  for (const { file, name } of files) {
    const [unit] = await db
      .insert(units)
      .values({
        slug: file.unit.slug,
        titleDe: file.unit.titleDe,
        descriptionDe: file.unit.descriptionDe ?? null,
        position: file.unit.position,
      })
      .onConflictDoUpdate({
        target: units.slug,
        set: {
          titleDe: file.unit.titleDe,
          descriptionDe: file.unit.descriptionDe ?? null,
          position: file.unit.position,
        },
      })
      .returning({ id: units.id });
    if (!unit) throw new Error(`${name}: failed to upsert unit`);
    report.unitsUpserted += 1;

    const noteIds = new Map<string, string>();
    for (const note of file.grammarNotes) {
      const [row] = await db
        .insert(grammarNotes)
        .values({
          slug: note.slug,
          titleDe: note.titleDe,
          bodyDe: note.bodyDe,
          tags: note.tags,
          source: "seed",
          status: "active",
        })
        .onConflictDoUpdate({
          target: grammarNotes.slug,
          set: { titleDe: note.titleDe, bodyDe: note.bodyDe, tags: note.tags, updatedAt: new Date() },
        })
        .returning({ id: grammarNotes.id });
      if (!row) throw new Error(`${name}: failed to upsert grammar note ${note.slug}`);
      noteIds.set(note.slug, row.id);
      report.grammarNotesUpserted += 1;
    }

    for (const lesson of file.lessons) {
      const [lessonRow] = await db
        .insert(lessons)
        .values({
          unitId: unit.id,
          slug: lesson.slug,
          titleDe: lesson.titleDe,
          goalDe: lesson.goalDe ?? null,
          introDe: lesson.introDe ?? null,
          position: lesson.position,
          estimatedMinutes: lesson.estimatedMinutes,
          source: "seed",
          status,
        })
        .onConflictDoUpdate({
          target: lessons.slug,
          set: {
            unitId: unit.id,
            titleDe: lesson.titleDe,
            goalDe: lesson.goalDe ?? null,
            introDe: lesson.introDe ?? null,
            position: lesson.position,
            estimatedMinutes: lesson.estimatedMinutes,
            updatedAt: new Date(),
          },
        })
        .returning({ id: lessons.id });
      if (!lessonRow) throw new Error(`${name}: failed to upsert lesson ${lesson.slug}`);
      report.lessonsUpserted += 1;

      // Re-importing a lesson replaces its item list rather than appending.
      await db.delete(lessonItems).where(eq(lessonItems.lessonId, lessonRow.id));
      await db.delete(grammarNoteLinks).where(eq(grammarNoteLinks.lessonId, lessonRow.id));

      for (const slug of lesson.grammarNoteSlugs) {
        const noteId = noteIds.get(slug);
        if (!noteId) {
          // Notes may live in another unit's file; look them up globally.
          const [row] = await db
            .select({ id: grammarNotes.id })
            .from(grammarNotes)
            .where(eq(grammarNotes.slug, slug))
            .limit(1);
          if (!row) {
            log(`  warning: ${name}/${lesson.slug} references unknown grammar note "${slug}"`);
            continue;
          }
          noteIds.set(slug, row.id);
        }
        await db
          .insert(grammarNoteLinks)
          .values({ noteId: noteIds.get(slug) as string, lessonId: lessonRow.id });
      }

      for (const [index, item] of lesson.items.entries()) {
        const normalized = normalizeSlovene(item.slovene);

        if (item.kind === "lexeme") {
          const key = `${normalized}|${item.partOfSpeech}`;
          let lexemeId = lexemeIds.get(key);
          if (lexemeId) {
            report.duplicates.push(item.slovene);
            // A curriculum entry knows more than the frequency deck does:
            // fill in the German gloss the deck could not supply.
            await db
              .update(lexemes)
              .set({
                german: item.german,
                gender: item.gender ?? null,
                aspect: item.aspect ?? null,
                notes: item.notes ?? null,
                register: item.register,
                status,
                updatedAt: new Date(),
              })
              .where(eq(lexemes.id, lexemeId));
          } else {
            const [row] = await db
              .insert(lexemes)
              .values({
                slovene: item.slovene,
                sloveneNormalized: normalized,
                german: item.german,
                partOfSpeech: item.partOfSpeech,
                gender: item.gender ?? null,
                aspect: item.aspect ?? null,
                register: item.register,
                regionLabel: item.regionLabel ?? null,
                notes: item.notes ?? null,
                difficulty: item.difficulty,
                tags: item.tags,
                source: "seed",
                status,
              })
              .returning({ id: lexemes.id });
            if (!row) throw new Error(`${name}: failed to insert lexeme ${item.slovene}`);
            lexemeId = row.id;
            lexemeIds.set(key, lexemeId);
            report.lexemesInserted += 1;
          }

          await db.insert(lessonItems).values({
            lessonId: lessonRow.id,
            lexemeId,
            position: index,
            teachingNoteDe: item.teachingNoteDe ?? null,
          });
          continue;
        }

        let phraseId = phraseIds.get(normalized);
        if (phraseId) {
          report.phrasesSkipped += 1;
          report.duplicates.push(item.slovene);
          await db
            .update(phrases)
            .set({
              german: item.german,
              contextNote: item.contextNote ?? null,
              register: item.register,
              status,
              updatedAt: new Date(),
            })
            .where(eq(phrases.id, phraseId));
        } else {
          const [row] = await db
            .insert(phrases)
            .values({
              slovene: item.slovene,
              sloveneNormalized: normalized,
              german: item.german,
              contextNote: item.contextNote ?? null,
              register: item.register,
              regionLabel: item.regionLabel ?? null,
              notes: item.notes ?? null,
              difficulty: item.difficulty,
              tags: item.tags,
              source: "seed",
              status,
            })
            .returning({ id: phrases.id });
          if (!row) throw new Error(`${name}: failed to insert phrase ${item.slovene}`);
          phraseId = row.id;
          phraseIds.set(normalized, phraseId);
          report.phrasesInserted += 1;
        }

        await db.insert(lessonItems).values({
          lessonId: lessonRow.id,
          phraseId,
          position: index,
          teachingNoteDe: item.teachingNoteDe ?? null,
        });

        for (const cloze of item.cloze) {
          await db
            .insert(clozeItems)
            .values({
              phraseId,
              position: cloze.position,
              answer: cloze.answer,
              answerNormalized: normalizeSlovene(stripPunctuation(cloze.answer)),
              focusCase: cloze.focusCase ?? null,
              focusNumber: cloze.focusNumber ?? null,
              focusVerbForm: cloze.focusVerbForm ?? null,
              hintDe: cloze.hintDe ?? null,
              source: "seed",
              status,
            })
            .onConflictDoUpdate({
              target: [clozeItems.phraseId, clozeItems.position],
              set: {
                answer: cloze.answer,
                answerNormalized: normalizeSlovene(stripPunctuation(cloze.answer)),
                hintDe: cloze.hintDe ?? null,
                status,
              },
            });
          report.clozeInserted += 1;
        }
      }
    }
  }
}

/**
 * Links phrases to the lexemes they contain by matching each token against
 * known dictionary forms and, failing that, against the inflected forms in
 * word_forms. Done automatically so nobody hand-annotates 300 phrases.
 */
async function linkPhraseLexemes(
  db: Db,
  report: ImportReport,
  log: (message: string) => void,
): Promise<void> {
  const allPhrases = await db
    .select({ id: phrases.id, slovene: phrases.slovene })
    .from(phrases);

  const byLemma = new Map<string, string>();
  for (const row of await db
    .select({ id: lexemes.id, normalized: lexemes.sloveneNormalized })
    .from(lexemes)) {
    if (!byLemma.has(row.normalized)) byLemma.set(row.normalized, row.id);
  }

  // A surface form is often several things at once — `sestri` is both dative
  // singular and nominative dual. Without a tagger there is no way to tell from
  // the string alone, so the link is resolved deterministically: the most
  // frequent lemma wins, and the word form is a hint the teacher UI can correct.
  const byForm = new Map<string, { lexemeId: string; wordFormId: string }>();
  for (const row of await db
    .select({
      id: wordForms.id,
      lexemeId: wordForms.lexemeId,
      normalized: wordForms.formNormalized,
      rank: lexemes.frequencyRank,
    })
    .from(wordForms)
    .innerJoin(lexemes, eq(lexemes.id, wordForms.lexemeId))
    .orderBy(asc(lexemes.frequencyRank), asc(wordForms.form))) {
    if (!byForm.has(row.normalized)) {
      byForm.set(row.normalized, { lexemeId: row.lexemeId, wordFormId: row.id });
    }
  }

  const existing = new Set<string>();
  for (const row of await db
    .select({ phraseId: phraseLexemes.phraseId, position: phraseLexemes.position })
    .from(phraseLexemes)) {
    existing.add(`${row.phraseId}|${row.position}`);
  }

  const rows: (typeof phraseLexemes.$inferInsert)[] = [];
  for (const phrase of allPhrases) {
    const tokens = tokenizePhrase(phrase.slovene);
    for (const [position, token] of tokens.entries()) {
      if (existing.has(`${phrase.id}|${position}`)) continue;
      const normalized = normalizeSlovene(stripPunctuation(token));
      if (!normalized) continue;

      const direct = byLemma.get(normalized);
      const inflected = byForm.get(normalized);
      if (!direct && !inflected) continue;

      rows.push({
        phraseId: phrase.id,
        lexemeId: direct ?? (inflected as { lexemeId: string }).lexemeId,
        wordFormId: inflected?.wordFormId ?? null,
        position,
      });
    }
  }

  for (const batch of chunked(rows)) {
    await db.insert(phraseLexemes).values(batch).onConflictDoNothing();
    report.phraseLexemeLinks += batch.length;
  }
  log(`linked ${report.phraseLexemeLinks} phrase tokens to lexemes`);
}
