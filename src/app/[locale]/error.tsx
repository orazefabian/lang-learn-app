"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Session progress lives on the server, so a client-side crash here costs
 * nothing but the current screen — the retry picks up where she was.
 */
export default function LocaleError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errors");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-lg">{t("generic")}</p>
      <Button onClick={reset} size="lg">
        {t("retry")}
      </Button>
    </main>
  );
}
