import { db } from "@/db/client";
import { generateMissingAudio } from "@/lib/audio/pipeline";
import { getTtsClient } from "@/lib/audio/tts";

/**
 * Generates the missing TTS audio for the content in the database.
 *
 * Audio is made at content-creation time, not at request time, so this runs
 * after seeding, after approving AI drafts, or after a bulk edit — never while
 * she is waiting for a card.
 *
 *   pnpm audio:generate                # active content only
 *   pnpm audio:generate --drafts       # drafts too, for reviewing before approval
 */
const includeDrafts = process.argv.includes("--drafts");

const client = getTtsClient();
if (!(await client.isAvailable())) {
  console.error(
    `no text-to-speech service reachable (engine: ${client.engine}).\n` +
      "Start Piper and set PIPER_URL, e.g. PIPER_URL=http://localhost:5000",
  );
  process.exit(1);
}

console.log(`generating audio with ${client.engine}…`);

let lastReport = 0;
const report = await generateMissingAudio(db, {
  client,
  includeDrafts,
  onProgress: (done, total) => {
    // One line every 25 items; a progress bar in a log file helps nobody.
    if (done === total || done - lastReport >= 25) {
      lastReport = done;
      console.log(`  ${done}/${total}`);
    }
  },
});

console.log("\naudio generation complete");
console.log(`  created  ${report.created}`);
console.log(`  reused   ${report.reused}`);
console.log(`  skipped  ${report.skipped}`);
console.log(`  failed   ${report.failed}`);

if (report.failures.length) {
  console.log("\nfailures:");
  for (const failure of report.failures.slice(0, 20)) {
    console.log(`  ${failure.text}: ${failure.reason}`);
  }
}

process.exit(report.failed > 0 ? 1 : 0);
