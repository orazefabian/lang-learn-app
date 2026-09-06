import { beforeAll, describe, expect, it } from "vitest";

process.env.SESSION_SECRET ??= "test-session-secret-that-is-long-enough";
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { parseCookie, serializeCookie } from "@/lib/auth/session";

describe("password hashing", () => {
  let digest: string;

  beforeAll(async () => {
    digest = await hashPassword("dober dan, kako si?");
  }, 20_000);

  it("produces an argon2id hash", () => {
    expect(digest.startsWith("$argon2id$")).toBe(true);
  });

  it("accepts the right password", async () => {
    await expect(verifyPassword(digest, "dober dan, kako si?")).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    await expect(verifyPassword(digest, "dober dan, kako si")).resolves.toBe(false);
  });

  it("treats a malformed hash as a failed login rather than an error", async () => {
    await expect(verifyPassword("not-a-hash", "anything")).resolves.toBe(false);
  });
});

describe("session cookies", () => {
  it("round-trips a session id", () => {
    const value = serializeCookie("session-abc");
    expect(parseCookie(value)).toBe("session-abc");
  });

  it("rejects a cookie whose id was swapped", () => {
    const value = serializeCookie("session-abc");
    const signature = value.slice(value.lastIndexOf(".") + 1);
    expect(parseCookie(`session-xyz.${signature}`)).toBeNull();
  });

  it("rejects a cookie with no signature", () => {
    expect(parseCookie("session-abc")).toBeNull();
    expect(parseCookie(undefined)).toBeNull();
  });

  it("keeps ids containing dots intact", () => {
    const id = "a.b.c";
    expect(parseCookie(serializeCookie(id))).toBe(id);
  });
});
