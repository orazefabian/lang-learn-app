"use client";

import { useState, useTransition } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { updateAutoplay } from "@/app/[locale]/(shell)/settings-actions";

/**
 * Silent mode. Only the *automatic* play is switched off; the play, replay and
 * slow buttons keep working, and clips are still fetched and cached.
 */
export function AutoplayToggle({ initial }: { initial: boolean }) {
  const t = useTranslations("silentMode");
  const [autoplay, setAutoplay] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !autoplay;
    setAutoplay(next);
    startTransition(async () => {
      const result = await updateAutoplay(next).catch(() => ({ ok: false }));
      // Offline or failed: put the switch back so it never claims something untrue.
      if (!result.ok) setAutoplay(!next);
    });
  }

  const Icon = autoplay ? Volume2 : VolumeX;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={autoplay}
      disabled={pending}
      onClick={toggle}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-2 text-left text-sm"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex flex-col">
        <span className="font-medium">{t("label")}</span>
        <span className="text-muted-foreground">{autoplay ? t("on") : t("off")}</span>
      </span>
    </button>
  );
}
