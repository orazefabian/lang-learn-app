"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";
import { runGeneration, type GenerateState } from "../ai-actions";

/**
 * Asking for a batch.
 *
 * The result screen is deliberately undramatic: a count, the model's own
 * caveats, whatever was dropped, and one link to the review queue. Nothing
 * here is finished content, and the wording should not suggest it is.
 */
function RunButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" block disabled={pending}>
      <Sparkles />
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function GenerateForm() {
  const t = useTranslations("teacher.generate");
  const [state, action] = useActionState<GenerateState, FormData>(runGeneration, {
    status: "idle",
  });

  if (state.status === "done" && state.result) {
    const { result } = state;
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
        <p className="font-medium">
          {t("doneTitle", { count: result.drafted })}
        </p>
        <p className="text-sm text-muted-foreground">{t("doneHint")}</p>

        {result.duplicates > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("duplicates", { count: result.duplicates })}
          </p>
        ) : null}

        {result.modelNotes ? (
          <div className="flex flex-col gap-1 border-l-2 border-accent pl-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {t("modelNotes")}
            </p>
            <p className="text-sm">{result.modelNotes}</p>
          </div>
        ) : null}

        {result.warnings.length ? (
          <ul className="flex flex-col gap-1">
            {result.warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {warning}
              </li>
            ))}
          </ul>
        ) : null}

        <Button asChild size="lg" block>
          <Link href={`/teacher/drafts?run=${result.runId}`}>{t("reviewNow")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="topic">{t("topic")}</Label>
        <Input id="topic" name="topic" required placeholder={t("topicPlaceholder")} />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="kind">{t("kind")}</Label>
          <select
            id="kind"
            name="kind"
            defaultValue="mixed"
            className="min-h-12 rounded-lg border border-input bg-card px-3 text-base"
          >
            {(["mixed", "phrases", "lexemes", "cloze"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`kinds.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex w-24 flex-col gap-2">
          <Label htmlFor="count">{t("count")}</Label>
          <Input id="count" name="count" type="number" min={1} max={30} defaultValue={8} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="instructions">{t("instructions")}</Label>
        <textarea
          id="instructions"
          name="instructions"
          rows={3}
          placeholder={t("instructionsPlaceholder")}
          className="min-h-20 w-full rounded-lg border border-input bg-card px-4 py-3 text-base"
        />
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message === "notConfigured"
            ? t("notConfigured")
            : state.message === "invalidInput"
              ? t("invalidInput")
              : t("failed", { reason: state.message ?? "" })}
        </p>
      ) : null}

      <RunButton label={t("run")} pendingLabel={t("running")} />
    </form>
  );
}
