"use server";

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { hashPassword, verifyPassword } from "./password";
import { SESSION_COOKIE, createSession, destroySession } from "./session";

export type LoginState = { error?: "invalidCredentials" | "missingFields" | "unexpectedError" };

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
});

/**
 * A dummy hash to verify against when the email is unknown, so a wrong email
 * and a wrong password take the same amount of time.
 */
let dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  dummyHash ??= await hashPassword("not-a-real-password");
  return dummyHash;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) return { error: "missingFields" };

  try {
    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);

    const digest = user?.passwordHash ?? (await getDummyHash());
    const ok = await verifyPassword(digest, parsed.data.password);

    if (!ok || !user?.passwordHash) {
      logger.warn({ email: parsed.data.email }, "failed login");
      return { error: "invalidCredentials" };
    }

    const headerList = await headers();
    const session = await createSession(user.id, headerList.get("user-agent") ?? undefined);

    const store = await cookies();
    store.set(SESSION_COOKIE, session.cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: env().NODE_ENV === "production",
      path: "/",
      expires: session.expiresAt,
    });
  } catch (error) {
    logger.error({ err: error }, "login failed unexpectedly");
    return { error: "unexpectedError" };
  }

  redirect("/");
}

export async function logout(): Promise<void> {
  const store = await cookies();
  await destroySession(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
