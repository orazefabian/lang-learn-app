import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { renderDigestEmail } from "./email";
import { getMailer, trySend, type Mailer } from "./mailer";
import { currentPeriod, type DigestSchedule } from "./schedule";
import { buildDigest, markEmailed, saveSnapshot } from "./service";

/**
 * Producing the week's digest.
 *
 * Runs for every learner account, is safe to call at any moment, and is a
 * no-op once the current week already has a snapshot. That property is what
 * lets the scheduler be a dumb interval rather than a cron with state.
 */

export function scheduleFromEnv(): DigestSchedule {
  const { DIGEST_DAY, DIGEST_HOUR, DIGEST_TIMEZONE } = env();
  return { day: DIGEST_DAY, hour: DIGEST_HOUR, timeZone: DIGEST_TIMEZONE };
}

export type RunResult = {
  periodStart: Date;
  periodEnd: Date;
  produced: { subjectUserId: string; snapshotId: string; created: boolean; emailed: boolean }[];
};

export async function runWeeklyDigest(
  db: Db,
  options: { now?: Date; force?: boolean; email?: boolean; mailer?: Mailer | null } = {},
): Promise<RunResult> {
  const now = options.now ?? new Date();
  const schedule = scheduleFromEnv();
  const period = currentPeriod(now, schedule);

  const learners = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.role, "learner"));

  const produced: RunResult["produced"] = [];

  for (const learner of learners) {
    const data = await buildDigest(db, {
      subjectUserId: learner.id,
      period,
      now,
    });

    const { id, created } = await saveSnapshot(db, {
      subjectUserId: learner.id,
      period,
      data,
      replace: options.force,
    });

    let emailed = false;

    // Only a newly created snapshot mails. Re-running the job, or forcing a
    // rebuild, must not send the same week twice.
    if (options.email !== false && created) {
      const mailer = options.mailer !== undefined ? options.mailer : getMailer();
      const sent = await trySend(
        mailer,
        renderDigestEmail({
          subjectName: learner.displayName,
          data,
          appUrl: env().APP_URL,
        }),
      );
      if (sent) {
        await markEmailed(db, id);
        emailed = true;
      }
    }

    produced.push({ subjectUserId: learner.id, snapshotId: id, created, emailed });
  }

  logger.info(
    {
      periodStart: period.start.toISOString(),
      created: produced.filter((entry) => entry.created).length,
      emailed: produced.filter((entry) => entry.emailed).length,
    },
    "weekly digest run",
  );

  return { periodStart: period.start, periodEnd: period.end, produced };
}

/**
 * The scheduler.
 *
 * A plain interval rather than a cron expression: the job is idempotent per
 * week, so "check every so often and write it if it is not there" needs no
 * persistent scheduler state and survives restarts, which a single-host
 * deployment on a home server does a lot of. A Kubernetes CronJob can call
 * `pnpm digest:run` instead and this stays off.
 */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

export function startDigestScheduler(db: Db): () => void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runWeeklyDigest(db);
    } catch (error) {
      // A failed digest must never take the server down with it.
      logger.error({ err: error }, "the digest scheduler failed");
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  // Never hold the process open on its own account.
  timer.unref?.();

  return () => clearInterval(timer);
}
