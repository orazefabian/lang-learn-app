"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOffline } from "./offline-provider";

/**
 * The one piece of connection UI.
 *
 * It appears when she is offline or something is waiting, and says only that
 * her answers are safe. No error styling, no retry button she has to press —
 * the sync happens on its own, and a red banner over a session she is in the
 * middle of would be the app worrying at her.
 */
export function OfflineBanner() {
  const t = useTranslations("offline");
  const { online, queued, syncing } = useOffline();

  if (online && !queued) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-border bg-secondary px-4 py-2 text-sm text-secondary-foreground"
    >
      {online ? (
        <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} aria-hidden />
      ) : (
        <CloudOff className="size-4" aria-hidden />
      )}
      <span>
        {!online
          ? t("offline")
          : syncing
            ? t("syncing")
            : t("waiting", { count: queued })}
      </span>
    </div>
  );
}
