import { db } from "@/db/client";
import { runWeeklyDigest, scheduleFromEnv } from "@/lib/digest/run";
import { currentPeriod } from "@/lib/digest/schedule";

/**
 * Produces the current week's digest.
 *
 * The path for a Kubernetes CronJob or a host crontab, and for looking at the
 * week early. Safe to run repeatedly: an existing week is left alone unless
 * --force rebuilds it, and only a newly created snapshot is ever emailed.
 *
 *   pnpm digest:run              # write it if it is not there yet
 *   pnpm digest:run --force      # rebuild this week from current data
 *   pnpm digest:run --no-email   # never send, whatever SMTP says
 */
const force = process.argv.includes("--force");
const email = !process.argv.includes("--no-email");

const now = new Date();
const period = currentPeriod(now, scheduleFromEnv());
console.log(`week ${period.start.toISOString()} → ${period.end.toISOString()}`);

const result = await runWeeklyDigest(db, { now, force, email });

for (const entry of result.produced) {
  const state = entry.created ? "written" : "already existed";
  const mail = entry.emailed ? ", emailed" : "";
  console.log(`  ${entry.subjectUserId}: ${state}${mail}`);
}
if (!result.produced.length) console.log("  no learner accounts");

process.exit(0);
