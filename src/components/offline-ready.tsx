"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { loadBundle } from "@/lib/offline/store";
import { useOffline } from "./offline-provider";

/**
 * A quiet chip on the home screen saying the next session is already here.
 *
 * It exists so that "will this work on the train" is answered before she is on
 * the train. It never asks her to do anything — the download happens on its
 * own — and it says nothing at all until there is something to say.
 */
export function OfflineReady() {
  const t = useTranslations("offline");
  const { online } = useOffline();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    // After the provider has had its go at fetching a fresh bundle.
    const timer = setTimeout(() => {
      void loadBundle().then((bundle) => {
        if (!cancelled) setCount(bundle?.cards.length ?? 0);
      });
    }, 2_500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [online]);

  if (!count) return null;

  return (
    <p
      className="flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary"
      title={t("readyBody", { count })}
    >
      <Check className="size-3.5" strokeWidth={3} aria-hidden />
      {t("readyShort")}
      <span className="sr-only">{t("readyBody", { count })}</span>
    </p>
  );
}
