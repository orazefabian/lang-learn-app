import pino from "pino";

/** Structured logs everywhere; one line of JSON per event in production. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "slovenscina" },
  redact: {
    paths: ["req.headers.cookie", "password", "passwordHash", "ANTHROPIC_API_KEY"],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;
