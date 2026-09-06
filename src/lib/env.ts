import { z } from "zod";

/**
 * All configuration comes from the environment. Parsed once, at first import,
 * so a misconfigured deployment fails at startup rather than mid-session.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  /**
   * Connection pool size. The default suits real PostgreSQL; the PGlite
   * development database in `pnpm dev:db` serves one connection at a time and
   * needs DB_POOL_MAX=1.
   */
  DB_POOL_MAX: z.coerce.number().int().positive().max(100).optional(),
  /**
   * HMAC key for session cookies. Optional here so CLI tools that only touch
   * the database can run with DATABASE_URL alone; the server checks for it at
   * startup and signing throws loudly if it is missing.
   */
  SESSION_SECRET: z.string().min(32).optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(90),

  /** Where audio lives. Mounted as a volume in every deployment target. */
  MEDIA_ROOT: z.string().default("./media"),

  PIPER_URL: z.string().url().optional(),
  PIPER_VOICE: z.string().default("sl_SI-artur-medium"),

  WHISPER_URL: z.string().url().optional(),
  WHISPER_MODEL: z.string().default("medium"),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),

  SMTP_URL: z.string().optional(),
  DIGEST_EMAIL_TO: z.string().email().optional(),
  DIGEST_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

let cached: Env | null = null;

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/**
 * The session signing key. Throws rather than silently signing with a
 * placeholder, which would hand out forgeable cookies.
 */
export function sessionSecret(): string {
  const secret = env().SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set (needs at least 32 characters)");
  }
  return secret;
}

/** True when the optional service is configured; features degrade, never crash. */
export const isTtsConfigured = (): boolean => Boolean(env().PIPER_URL);
export const isAsrConfigured = (): boolean => Boolean(env().WHISPER_URL);
export const isAiConfigured = (): boolean => Boolean(env().ANTHROPIC_API_KEY);
