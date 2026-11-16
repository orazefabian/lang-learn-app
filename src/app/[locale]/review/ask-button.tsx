"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, CircleQuestionMark } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { askAboutCard } from "./actions";

/**
 * The unobtrusive way out of being stuck: a round button in the session's top
 * bar that opens a sheet from the bottom, where the thumb already is.
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

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={sent}
        aria-label={t("button")}
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-secondary disabled:text-primary"
      >
        {sent ? <Check className="size-5" aria-hidden /> : <CircleQuestionMark className="size-5" aria-hidden />}
      </button>

      {sent ? (
        <p
          role="status"
          className="fixed inset-x-0 top-16 z-30 mx-auto w-fit rounded-full bg-foreground px-4 py-2 text-sm font-bold text-background shadow-lg"
        >
          {t("sent")}
        </p>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center">
          <button
            type="button"
            aria-label={t("cancel")}
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-foreground/30"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ask-title"
            className="relative flex w-full max-w-md flex-col gap-4 rounded-t-3xl bg-card px-5 pt-5"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.25rem)" }}
          >
            <span aria-hidden className="mx-auto h-1 w-10 rounded-full bg-border" />
            <div className="flex flex-col gap-1">
              <p id="ask-title" className="text-lg font-bold">
                {t("title")}
              </p>
              <p className="text-sm text-muted-foreground">{t("hint")}</p>
            </div>

            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              autoFocus
              placeholder={t("placeholder")}
              aria-label={t("title")}
              className="min-h-24 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-base"
            />

            <div className="flex gap-2.5">
              <Button
                variant="ghost"
                className="h-14 rounded-2xl px-5 font-bold"
                onClick={() => setOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                className="h-14 flex-1 rounded-2xl font-bold"
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
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
