import { defineConfig } from "drizzle-kit";

// drizzle-kit has no --env-file of its own, and the package scripts all read
// .env; without this, `db:generate` would be the one command that does not.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env: the environment is expected to carry DATABASE_URL already.
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://slo:slo@localhost:5432/dober_dan",
  },
  strict: true,
  verbose: true,
});
