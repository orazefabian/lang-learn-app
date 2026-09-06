import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { env, sessionSecret } from "@/lib/env";

export const SESSION_COOKIE = "slo_session";

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  role: "learner" | "teacher";
  locale: string;
};

function sign(sessionId: string): string {
  return createHmac("sha256", sessionSecret()).update(sessionId).digest("base64url");
}

/** Cookie value is `<id>.<hmac>`; the id alone is never enough. */
export function serializeCookie(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

export function parseCookie(value: string | undefined): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const id = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = sign(id);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export async function createSession(userId: string, userAgent?: string) {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id, userId, expiresAt, userAgent: userAgent ?? null });
  return { id, expiresAt, cookieValue: serializeCookie(id) };
}

export async function resolveSession(cookieValue: string | undefined): Promise<SessionUser | null> {
  const id = parseCookie(cookieValue);
  if (!id) return null;

  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      locale: users.locale,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    locale: row.locale,
  };
}

export async function touchSession(cookieValue: string | undefined): Promise<void> {
  const id = parseCookie(cookieValue);
  if (!id) return;
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
}

export async function destroySession(cookieValue: string | undefined): Promise<void> {
  const id = parseCookie(cookieValue);
  if (!id) return;
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function pruneExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
