import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const BASE = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  SESSION_SECRET: "a-secret-that-is-at-least-32-characters",
};

/**
 * Configuration parsing.
 *
 * The case that matters here is the one that used to stop the server from
 * booting: .env.example lists every key it documents, most of them blank, so
 * copying it verbatim has to be a working configuration.
 */
describe("blank variables", () => {
  it("treats a copied .env.example as a valid configuration", () => {
    const env = parseEnv({
      ...BASE,
      PIPER_URL: "",
      WHISPER_URL: "",
      ANTHROPIC_API_KEY: "",
      SMTP_URL: "",
      DIGEST_EMAIL_TO: "",
      DB_POOL_MAX: "",
      LEARNER_PASSWORD: "",
    });

    expect(env.PIPER_URL).toBeUndefined();
    expect(env.WHISPER_URL).toBeUndefined();
    expect(env.DIGEST_EMAIL_TO).toBeUndefined();
    expect(env.DB_POOL_MAX).toBeUndefined();
  });

  it("keeps the defaults a blank value would otherwise overwrite", () => {
    const env = parseEnv({ ...BASE, PIPER_VOICE: "", WHISPER_MODEL: "", LOG_LEVEL: "" });
    expect(env.PIPER_VOICE).toBe("sl_SI-artur-medium");
    expect(env.WHISPER_MODEL).toBe("medium");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("still rejects a value that is set and wrong", () => {
    expect(() => parseEnv({ ...BASE, SESSION_SECRET: "too-short" })).toThrow(/SESSION_SECRET/);
    expect(() => parseEnv({ ...BASE, WHISPER_URL: "not a url" })).toThrow(/WHISPER_URL/);
  });

  /** The realistic typo: the scheme left off an internal service address. */
  it("rejects a service address with no http scheme on it", () => {
    expect(() => parseEnv({ ...BASE, PIPER_URL: "piper:5000" })).toThrow(/PIPER_URL/);
    expect(() => parseEnv({ ...BASE, PIPER_URL: "localhost:5000" })).toThrow(/PIPER_URL/);
    expect(parseEnv({ ...BASE, PIPER_URL: "http://piper:5000" }).PIPER_URL).toBe(
      "http://piper:5000",
    );
  });

  it("insists on a database url", () => {
    expect(() => parseEnv({ SESSION_SECRET: BASE.SESSION_SECRET })).toThrow(/DATABASE_URL/);
  });
});
