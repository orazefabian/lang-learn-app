import createIntlMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

/**
 * Locale negotiation only. Auth is enforced in server components via
 * requireUser(), because the middleware runtime cannot reach the database.
 */
export function middleware(request: NextRequest): NextResponse {
  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|media|icons|manifest.webmanifest|.*\\..*).*)"],
};
