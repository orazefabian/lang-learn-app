"use client";

import { useState, useTransition } from "react";
import { Check, Copy, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import type { Proposal } from "@/lib/ai/review";
import { approveProposalAction, decideRunAction, rejectProposalAction } from "../ai-actions";

/**
 * The review queue.
 *
 * Every field is editable in place, because correcting a proposal and
 * approving it is one action, not two: the alternative is approving something
 * slightly wrong and fixing it later, which means she has already seen it.
 */
export function DraftList({
  proposals,
  runId,
}: {
  proposals: Proposal[];
  runId: string | null;
}) {
  const t = useTranslations("teacher.drafts");
  const router = useRouter();

  /** Decided cards leave the list immediately; the server catches up after. */
  const [decided, setDecided] = useState<Record<string, "approved" | "rejected">>({});
  const [batchPending, startBatch] = useTransition();

  const remaining = proposals.filter((proposal) => !decided[proposal.id]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("pending", { count: remaining.length })}
        </p>
        {runId && remaining.length > 1 ? (
          <div className="flex gap-3 text-sm">
            <button
              type="button"
              disabled={batchPending}
              onClick={() =>
                startBatch(async () => {
                  await decideRunAction({ runId, decision: "approved" });
                  router.refresh();
                })
              }
              className="text-primary hover:underline disabled:opacity-50"
            >
              {t("approveAll")}
            </button>
            <button
              type="button"
              disabled={batchPending}
              onClick={() =>
                startBatch(async () => {
                  await decideRunAction({ runId, decision: "rejected" });
                  router.refresh();
                })
              }
              className="text-muted-foreground hover:underline disabled:opacity-50"
            >
              {t("rejectAll")}
            </button>
          </div>
        ) : null}
      </div>

      <ul className="flex flex-col gap-4">
        {remaining.map((proposal) => (
          <li key={proposal.id}>
            <DraftCard
              proposal={proposal}
              onDecided={(decision) =>
                setDecided((current) => ({ ...current, [proposal.id]: decision }))
              }
            />
          </li>
        ))}
      </ul>

      {remaining.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
          {t("allDecided")}
        </p>
      ) : null}
    </div>
  );
}

function DraftCard({
  proposal,
  onDecided,
}: {
  proposal: Proposal;
  onDecided: (decision: "approved" | "rejected") => void;
}) {
  const t = useTranslations("teacher.drafts");
  const tRegister = useTranslations("teacher.registerLabel");
  const [pending, startTransition] = useTransition();

  const item = proposal.draft ?? proposal.duplicateOf;
  if (!item) return null;

  const isDuplicate = !proposal.draft && Boolean(proposal.duplicateOf);

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5"
      action={(formData) => {
        formData.set("proposalId", proposal.id);
        startTransition(async () => {
          await approveProposalAction(formData);
          onDecided("approved");
        });
      }}
    >
      {isDuplicate ? (
        /*
         * Duplicates are shown, never silently skipped. Approving one fills in
         * what the existing entry is missing instead of adding a second copy.
         */
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Copy className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("duplicateWarning")}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor={`slovene-${proposal.id}`}>{t("slovene")}</Label>
        <Input
          id={`slovene-${proposal.id}`}
          name="slovene"
          defaultValue={item.slovene}
          readOnly={isDuplicate}
          className="slovene text-lg"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`german-${proposal.id}`}>{t("german")}</Label>
        <Input
          id={`german-${proposal.id}`}
          name="german"
          // On a duplicate the existing entry wins; the proposal only fills gaps.
          defaultValue={item.german || proposal.proposed.german}
          placeholder={t("germanMissing")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`context-${proposal.id}`}>{t("contextNote")}</Label>
        <textarea
          id={`context-${proposal.id}`}
          name="contextNote"
          rows={2}
          defaultValue={item.contextNote ?? proposal.proposed.contextNote ?? ""}
          className="min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      {!isDuplicate ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`register-${proposal.id}`}>{t("register")}</Label>
          <select
            id={`register-${proposal.id}`}
            name="register"
            defaultValue={item.register}
            className="min-h-11 rounded-lg border border-input bg-background px-3 text-sm"
          >
            {(["standard", "colloquial", "regional", "formal"] as const).map((value) => (
              <option key={value} value={value}>
                {tRegister(value)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {proposal.cloze ? (
        <p className="text-sm text-muted-foreground">
          {t("clozeBlank", { answer: proposal.cloze.answer })}
          {proposal.cloze.hintDe ? ` — ${proposal.cloze.hintDe}` : ""}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" className="flex-1" disabled={pending}>
          <Check />
          {isDuplicate ? t("merge") : t("approve")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await rejectProposalAction({ proposalId: proposal.id });
              onDecided("rejected");
            })
          }
        >
          <X />
          {t("reject")}
        </Button>
      </div>
    </form>
  );
}
