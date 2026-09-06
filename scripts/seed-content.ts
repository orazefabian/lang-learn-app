import path from "node:path";
import { db } from "@/db/client";
import { importSeed } from "@/lib/seed/import";

/**
 * Imports the frequency deck and the curriculum.
 *
 * Content lands as `draft` unless --activate is passed: nothing reaches her
 * deck before the teacher has looked at it. Re-running is safe — existing
 * items are matched on their normalised Slovene form and updated in place.
 *
 *   pnpm seed:content                    # import as drafts
 *   pnpm seed:content --activate         # import and make live
 *   pnpm seed:content --curriculum-only  # skip the 1100-lemma deck
 */
const activate = process.argv.includes("--activate");
const skipFrequencyDeck = process.argv.includes("--curriculum-only");

const report = await importSeed({
  db,
  seedDir: path.join(process.cwd(), "seed"),
  activate,
  skipFrequencyDeck,
  log: (message) => console.log(message),
});

console.log("\nimport complete");
console.log(`  lexemes inserted     ${report.lexemesInserted}`);
console.log(`  word forms inserted  ${report.wordFormsInserted}`);
console.log(`  phrases inserted     ${report.phrasesInserted}`);
console.log(`  cloze items          ${report.clozeInserted}`);
console.log(`  units / lessons      ${report.unitsUpserted} / ${report.lessonsUpserted}`);
console.log(`  grammar notes        ${report.grammarNotesUpserted}`);
console.log(`  phrase-lexeme links  ${report.phraseLexemeLinks}`);
console.log(`  status               ${activate ? "active" : "draft"}`);

if (report.duplicates.length) {
  const shown = report.duplicates.slice(0, 15);
  console.log(`\n${report.duplicates.length} items already existed and were updated, not duplicated:`);
  console.log(`  ${shown.join(", ")}${report.duplicates.length > shown.length ? ", …" : ""}`);
}

process.exit(0);
