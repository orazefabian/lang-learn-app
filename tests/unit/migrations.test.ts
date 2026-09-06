import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Applies the checked-in migrations to a real Postgres (PGlite, in-process).
 * Catches SQL that Drizzle generated but Postgres would reject — cheaper than
 * finding out at deploy time.
 */
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

let db: PGlite;

async function applyMigrations(target: PGlite): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await target.exec(trimmed);
    }
  }
  return files;
}

beforeAll(async () => {
  db = new PGlite();
  await applyMigrations(db);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function tableNames(): Promise<string[]> {
  const result = await db.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  return result.rows.map((r) => r.table_name);
}

describe("migrations", () => {
  it("has at least one migration file", async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);
  });

  it("creates every domain table", async () => {
    const tables = await tableNames();
    for (const expected of [
      "users",
      "sessions",
      "auth_credentials",
      "lexemes",
      "word_forms",
      "phrases",
      "phrase_lexemes",
      "cloze_items",
      "units",
      "lessons",
      "lesson_items",
      "media_assets",
      "grammar_notes",
      "grammar_note_links",
      "cards",
      "review_logs",
      "speech_attempts",
      "study_sessions",
      "user_settings",
      "fsrs_optimization_runs",
      "questions",
      "lesson_progress",
      "digest_snapshots",
      "notifications",
      "generation_runs",
      "generation_items",
    ]) {
      expect(tables, `missing table ${expected}`).toContain(expected);
    }
  });

  it("models Slovene number with a dual", async () => {
    const result = await db.query<{ enumlabel: string }>(
      `select e.enumlabel from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       where t.typname = 'grammatical_number' order by e.enumsortorder`,
    );
    expect(result.rows.map((r) => r.enumlabel)).toEqual(["singular", "dual", "plural"]);
  });

  it("orders the case enum the way the course teaches cases", async () => {
    const result = await db.query<{ enumlabel: string }>(
      `select e.enumlabel from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       where t.typname = 'grammatical_case' order by e.enumsortorder`,
    );
    expect(result.rows.map((r) => r.enumlabel)).toEqual([
      "nominative",
      "accusative",
      "locative",
      "genitive",
      "dative",
      "instrumental",
    ]);
  });

  it("keeps a card unique per user, item and exercise type", async () => {
    const result = await db.query<{ indexname: string }>(
      "select indexname from pg_indexes where tablename = 'cards'",
    );
    const names = result.rows.map((r) => r.indexname);
    expect(names).toContain("cards_unique_lexeme");
    expect(names).toContain("cards_unique_phrase");
    expect(names).toContain("cards_unique_cloze");
  });

  it("re-applying is caught as a conflict rather than silently duplicating", async () => {
    const fresh = new PGlite();
    await applyMigrations(fresh);
    await expect(applyMigrations(fresh)).rejects.toThrow();
    await fresh.close();
  }, 60_000);
});
