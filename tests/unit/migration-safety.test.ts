import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migrations run unattended at every server start (`src/instrumentation.ts`),
 * against the only copy of her review history. `drizzle-kit generate` will
 * happily emit a DROP COLUMN for a renamed field, and nothing downstream tells
 * "drop an empty placeholder table" apart from "drop three months of reviews".
 *
 * So a destructive statement has to be acknowledged here, by file, with the
 * reason it is safe. That turns it into a visible decision in the diff rather
 * than a line buried in a generated file (see issue #10).
 */
const ACKNOWLEDGED_DESTRUCTIVE: Record<string, string> = {
  "0002_drop_unused_ai_run_placeholder.sql":
    "ai_generation_runs was a placeholder from step 1 that nothing ever wrote to",
};

const DESTRUCTIVE = [
  { name: "DROP TABLE", pattern: /\bdrop\s+table\b/i },
  { name: "DROP COLUMN", pattern: /\bdrop\s+column\b/i },
  { name: "DROP TYPE", pattern: /\bdrop\s+type\b/i },
  { name: "DROP SCHEMA", pattern: /\bdrop\s+schema\b/i },
  { name: "TRUNCATE", pattern: /\btruncate\b/i },
  { name: "DELETE FROM", pattern: /\bdelete\s+from\b/i },
  { name: "RENAME", pattern: /\brename\s+(column\s+|to\b)/i },
  { name: "ALTER COLUMN TYPE", pattern: /\balter\s+column\s+"?\w+"?\s+(set\s+data\s+)?type\b/i },
  // Not data loss, but fails the boot if any existing row is NULL.
  { name: "SET NOT NULL", pattern: /\bset\s+not\s+null\b/i },
];

const DIR = path.join(process.cwd(), "drizzle");

async function sqlFiles(): Promise<string[]> {
  return (await readdir(DIR)).filter((file) => file.endsWith(".sql")).sort();
}

describe("migration safety", () => {
  it("acknowledges every destructive statement explicitly", async () => {
    const unacknowledged: string[] = [];

    for (const file of await sqlFiles()) {
      if (file in ACKNOWLEDGED_DESTRUCTIVE) continue;
      const sql = await readFile(path.join(DIR, file), "utf8");
      for (const { name, pattern } of DESTRUCTIVE) {
        if (pattern.test(sql)) unacknowledged.push(`${file}: ${name}`);
      }
    }

    expect(
      unacknowledged,
      "Destructive migration. Prefer an additive change (new column, backfill, " +
        "drop later). If it really is safe, add the file to ACKNOWLEDGED_DESTRUCTIVE " +
        "with the reason.",
    ).toEqual([]);
  });

  it("only acknowledges files that exist", async () => {
    const files = new Set(await sqlFiles());
    const stale = Object.keys(ACKNOWLEDGED_DESTRUCTIVE).filter((file) => !files.has(file));
    expect(stale).toEqual([]);
  });

  /*
   * The migrator applies what `_journal.json` lists, not what is in the
   * folder. A SQL file without a journal entry is never run in production —
   * while the unit and integration suites, which read the folder directly,
   * pass happily.
   */
  it("lists every SQL file in the drizzle journal, in order", async () => {
    const journal = JSON.parse(await readFile(path.join(DIR, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };

    const journaled = journal.entries.map((entry) => `${entry.tag}.sql`);
    expect(journaled).toEqual(await sqlFiles());
    expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  it("has a snapshot for every journal entry", async () => {
    const snapshots = (await readdir(path.join(DIR, "meta"))).filter((file) =>
      file.endsWith("_snapshot.json"),
    );
    const files = await sqlFiles();
    expect(snapshots.length).toBe(files.length);
  });
});
