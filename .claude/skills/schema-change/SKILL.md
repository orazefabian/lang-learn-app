---
name: schema-change
description: Change the database schema safely — edit src/db/schema, generate the Drizzle migration, keep it additive, and update seeds, tests and docs. Use whenever a task adds, renames or removes a table, column, enum value or index, or when CI says migrations do not match the schema.
---

# Changing the schema

Migrations run **automatically at every server start** (`src/instrumentation.ts`)
against the only copy of the learner's review history. There is no manual
migration step and no pre-migration snapshot. Treat every migration as
irreversible.

## Rules

1. **Additive only, by default.** New tables, new nullable columns, new columns
   with a default, new enum values, new indexes.
2. **Never rename or drop in one step.** A rename is: add the new column →
   backfill → switch code → (a later PR) drop the old one. `drizzle-kit` will
   offer to rename interactively; it generates DROP+ADD if you answer wrong.
3. **No `NOT NULL` without a default** on an existing table — it fails the boot
   if any row is NULL, which takes the app down.
4. **Never edit a migration already on `main`.** Fix forward with a new one.
5. **Old code must survive the new schema** for the seconds between migration
   and restart: don't remove a column the running version still reads.

`tests/unit/migration-safety.test.ts` fails CI on DROP / TRUNCATE / DELETE /
RENAME / type changes / SET NOT NULL unless the file is listed in
`ACKNOWLEDGED_DESTRUCTIVE` with a reason. Adding an entry is a decision for the
human — **stop and ask** before acknowledging a destructive migration, and say
what data it would destroy.

## Steps

1. Edit the table in `src/db/schema/<area>.ts`. Enums go in
   `src/db/schema/enums.ts` with a comment saying why the values are what they
   are (look at `grammaticalCaseEnum` — order carries meaning).
   Columns are camelCase in TS; the client uses `casing: "snake_case"`.
2. Generate, with a name that says what it does (the history does this:
   `0004_add_slow_audio_path`):
   ```bash
   pnpm db:generate --name add_autoplay_setting
   ```
   This needs no database. It writes `drizzle/NNNN_add_autoplay_setting.sql`,
   a snapshot in `drizzle/meta/`, and a journal entry. Don't rename the files
   by hand afterwards — the migrator applies what the journal lists, and the
   safety test checks they agree. For a data-only migration (a backfill with no
   schema change) use `--custom` to get an empty journaled file.
3. **Read the generated SQL.** It is what will run on her data. Look for
   anything destructive or any default that would be wrong for existing rows.
4. If existing rows need a value, put the backfill in the same migration after
   the `--> statement-breakpoint` marker, as an idempotent `UPDATE`.
5. Mirror the change wherever the shape is restated:
   - `src/lib/seed/schemas.ts` + `seed/curriculum/*.json` if seeded content
     carries the field;
   - `src/lib/ai/schemas.ts` + `src/lib/ai/prompts.ts` if AI drafts produce it;
   - `src/lib/offline/bundle.ts` if review cards need it offline (and bump
     nothing in `sw.js` unless shell assets changed);
   - `scripts/ux/seed-scenario.ts` / `scripts/seed-e2e.ts` if their fixtures
     insert into the table and the column is required.
6. Tests:
   ```bash
   pnpm check              # migrations.test.ts applies every SQL file to PGlite
   pnpm test:integration   # services against the migrated schema
   ```
   Add the new table to the `creates every domain table` list in
   `tests/unit/migrations.test.ts`.
7. Confirm no drift: running `pnpm db:generate` again must print
   "No schema changes". CI runs exactly this.
8. Update `README.md` → "Domain model notes" when the model's meaning changes.

## When CI says "src/db/schema changed without a migration"

Someone edited `src/db/schema` and did not commit the generated files. Run
`pnpm db:generate`, read the SQL, commit `drizzle/`. Use `--name` so the file says what it does.
