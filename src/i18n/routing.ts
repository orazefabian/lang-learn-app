import { defineRouting } from "next-intl/routing";

/** German is the app language; English exists as a fallback for missing keys. */
export const routing = defineRouting({
  locales: ["de", "en"],
  defaultLocale: "de",
  /*
   * Always prefixed, so every URL is /de/... or /en/...
   *
   * "as-needed" is the nicer-looking option and it does not work here: on
   * next-intl 4.14 with Next 16 the un-prefixed default locale is answered
   * with an internal rewrite that Next turns into a 307 to the same path, so
   * every German URL — which is all of them — becomes a redirect loop in a
   * production build. It works in dev, which is how it survived this long.
   */
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
