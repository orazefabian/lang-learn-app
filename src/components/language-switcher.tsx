"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/** Each language is named in itself, so it can be found from the wrong one. */
const NAMES: Record<Locale, string> = { de: "Deutsch", en: "English" };

/**
 * Swaps only the locale segment of the current path. The next-intl middleware
 * remembers the choice in the NEXT_LOCALE cookie.
 */
export function LanguageSwitcher() {
  const t = useTranslations("language");
  const active = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div role="group" aria-label={t("label")} className="flex gap-2 text-sm">
      {routing.locales.map((locale) => {
        const current = locale === active;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-pressed={current}
            onClick={() => {
              if (!current) router.replace(pathname, { locale });
            }}
            className={cn(
              "min-h-9 rounded-md border px-3 transition-colors",
              current
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {NAMES[locale]}
          </button>
        );
      })}
    </div>
  );
}
