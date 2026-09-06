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

  /*
   * http(s) specifically: z.url() alone accepts any scheme, so a "piper:5000"
   * typed for "http://piper:5000" would validate here and fail at the first
   * request instead.
   */
  PIPER_URL: z.url({ protocol: /^https?$/ }).optional(),
  PIPER_VOICE: z.string().default("sl_SI-artur-medium"),

  WHISPER_URL: z.url({ protocol: /^https?$/ }).optional(),
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

type EnvSource = Record<string, string | undefined>;

/**
 * A blank variable means unset.
 *
 * .env.example lists every key, most of them empty, because it doubles as the
 * documentation of what the app reads. Passing those through as empty strings
 * would fail the optional URL and email checks and stop the server from
 * booting, so a blank value is dropped before validation — the same thing an
 * absent line means.
 */
function withoutBlanks(source: EnvSource): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    result[key] = value;
  }
  return result;
}

/** Exported for tests: the parse itself, with no process or cache involved. */
export function parseEnv(source: EnvSource): Env {
  const parsed = envSchema.safeParse(withoutBlanks(source));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

function loadEnv(): Env {
  return parseEnv(process.env);
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
