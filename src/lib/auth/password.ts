import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id parameters. Deliberately on the strong side: two users, and a
 * login happens rarely enough that ~100ms is invisible.
 */
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(digest: string, password: string): Promise<boolean> {
  try {
    return await verify(digest, password, OPTIONS);
  } catch {
    // A malformed hash must read as "wrong password", never as a crash.
    return false;
  }
}
