"use client";

import { useState, useTransition } from "react";
import { CircleQuestionMark } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { askAboutCard } from "./actions";

/**
 * The unobtrusive way out of being stuck.
 *
 * Sending is fire-and-forget: the confirmation appears immediately and the
 * session never waits on the network. Being stuck should cost her a tap, not
 * her momentum.
 */
export function AskButton({ cardId }: { cardId: string }) {
  const t = useTranslations("review.ask");
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const [, startTransition] = useTransition();

  if (sent) {
    return (
      <p className="text-center text-xs text-muted-foreground" role="status">
        {t("sent")}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <CircleQuestionMark className="size-3.5" aria-hidden />
        {t("button")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
      </div>

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        autoFocus
        placeholder={t("placeholder")}
        aria-label={t("title")}
        className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
      />

      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          onClick={() => {
            // Optimistic on purpose: she carries on either way.
            setSent(true);
            setOpen(false);
            startTransition(async () => {
              await askAboutCard({ cardId, body: body.trim() || undefined });
            });
          }}
        >
          {t("send")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
