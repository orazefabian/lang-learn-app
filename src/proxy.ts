import createIntlMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

/**
 * Locale negotiation only. Auth is enforced in server components via
 * requireUser(), because this runtime cannot reach the database.
 *
 * Named `proxy` in a file called proxy.ts: Next 16 renamed the middleware
 * convention, and the compatibility shim for the old name redirected the
 * default locale to itself in a production build — every German URL, which is
 * all of them.
 */
export default function proxy(request: NextRequest): NextResponse {
  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|media|icons|manifest.webmanifest|.*\\..*).*)"],
};
