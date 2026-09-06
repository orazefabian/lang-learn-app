/**
 * Runs once per server start, before the app serves traffic.
 *
 * Migrations live here rather than in the container entrypoint so that Next's
 * dependency tracing pulls the migrator into the standalone build, and so a
 * bare `next start` behaves the same as the Docker image.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Fail at boot, not at the first login attempt.
  const { sessionSecret } = await import("@/lib/env");
  sessionSecret();

  await runMigrations();
  await startScheduledJobs();
}

/**
 * The weekly digest, when it is switched on.
 *
 * Started after migrations so the first run cannot race the schema, and only
 * when DIGEST_ENABLED is set — a Kubernetes CronJob calling `pnpm digest:run`
 * is the other supported shape, and the two should not both be live.
 */
async function startScheduledJobs(): Promise<void> {
  const { env } = await import("@/lib/env");
  if (!env().DIGEST_ENABLED) return;

  const [{ db }, { startDigestScheduler }, { logger }] = await Promise.all([
    import("@/db/client"),
    import("@/lib/digest/run"),
    import("@/lib/logger"),
  ]);

  startDigestScheduler(db);
  logger.info(
    { day: env().DIGEST_DAY, hour: env().DIGEST_HOUR, timeZone: env().DIGEST_TIMEZONE },
    "digest scheduler started",
  );
}

async function runMigrations(): Promise<void> {
  if (process.env.RUN_MIGRATIONS_ON_START === "false") return;

  const [{ drizzle }, { migrate }, postgres, { logger }] = await Promise.all([
    import("drizzle-orm/postgres-js"),
    import("drizzle-orm/postgres-js/migrator"),
    import("postgres").then((m) => m.default),
    import("@/lib/logger"),
  ]);

  const url = process.env.DATABASE_URL;
  if (!url) {
    logger.warn("DATABASE_URL is not set; skipping migrations");
    return;
  }

  // The standalone server chdirs to its own root, where `drizzle/` is copied
  // alongside it; MIGRATIONS_DIR overrides that for unusual layouts.
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? "./drizzle";

  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
    logger.info("migrations up to date");
  } catch (error) {
    logger.error({ err: error }, "migrations failed");
    throw error;
  } finally {
    await client.end();
  }
}
