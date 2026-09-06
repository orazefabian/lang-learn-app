"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { loadBundle } from "@/lib/offline/store";
import { useOffline } from "./offline-provider";

/**
 * A quiet line on the home screen saying the next session is already here.
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
    <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <Download className="size-3.5" aria-hidden />
      {t("readyBody", { count })}
    </p>
  );
}
