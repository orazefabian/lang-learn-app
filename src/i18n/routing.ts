import { defineRouting } from "next-intl/routing";

/** German is the app language; English exists as a fallback for missing keys. */
export const routing = defineRouting({
  locales: ["de", "en"],
  defaultLocale: "de",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
