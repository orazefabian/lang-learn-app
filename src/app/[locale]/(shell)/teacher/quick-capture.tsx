"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, ChevronDown, Mic, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { SpeechRecorder, type RecordingResult } from "@/components/speech-recorder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";
import { suggestCaptureFields } from "./ai-actions";
import { quickCapture, uploadRecording, type CaptureState } from "./actions";

/**
 * Quick capture.
 *
 * Designed for the ten seconds between hearing something at a family dinner
 * and losing it: one field focused on load, one big save button, everything
 * else folded away. The extra fields are there when there is time, and the
 * content browser is there when there is not.
 */
function SaveButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" block disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function QuickCapture({ assistAvailable = false }: { assistAvailable?: boolean }) {
  const t = useTranslations("teacher.capture");
  const tItem = useTranslations("teacher.item");
  const tRegister = useTranslations("teacher.registerLabel");

  const [state, action] = useActionState<CaptureState, FormData>(quickCapture, {
    status: "idle",
  });
  const [expanded, setExpanded] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceSaved, setVoiceSaved] = useState(false);
  const [speaker, setSpeaker] = useState("");
  /** Set when she taps "another": shows the empty form again without a reload. */
  const [dismissed, setDismissed] = useState(false);

  /** Auto-fill: suggestions written into the form, never committed. */
  const [assisting, setAssisting] = useState(false);
  const [assistNote, setAssistNote] = useState<string | null>(null);
  const [assistError, setAssistError] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const sloveneRef = useRef<HTMLInputElement>(null);
  const germanRef = useRef<HTMLInputElement>(null);
  const contextRef = useRef<HTMLTextAreaElement>(null);
  const registerRef = useRef<HTMLSelectElement>(null);
  const regionRef = useRef<HTMLInputElement>(null);

  async function autofill() {
    const slovene = sloveneRef.current?.value.trim();
    if (!slovene) {
      sloveneRef.current?.focus();
      return;
    }

    setAssisting(true);
    setAssistError(false);
    setAssistNote(null);

    const result = await suggestCaptureFields({
      slovene,
      hint: contextRef.current?.value.trim() || undefined,
    });

    setAssisting(false);

    if (result.status !== "ok") {
      setAssistError(true);
      return;
    }

    /*
     * Filled in, not committed, and never over the top of something he typed:
     * a suggestion that quietly replaced his own words would be worse than no
     * suggestion at all.
     */
    const { suggestion } = result;
    if (germanRef.current && !germanRef.current.value.trim()) {
      germanRef.current.value = suggestion.german.join(", ");
    }
    if (contextRef.current && !contextRef.current.value.trim() && suggestion.contextNote) {
      contextRef.current.value = suggestion.contextNote;
    }
    if (suggestion.register !== "standard") {
      setExpanded(true);
      if (registerRef.current) registerRef.current.value = suggestion.register;
      if (regionRef.current && !regionRef.current.value.trim() && suggestion.regionLabel) {
        regionRef.current.value = suggestion.regionLabel;
      }
    }
    setAssistNote(suggestion.grammarNote ?? null);
  }

  useEffect(() => {
    sloveneRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state.status === "saved") {
      formRef.current?.reset();
      setAssistNote(null);
      setAssistError(false);
      setExpanded(false);
      setRecording(false);
      setVoiceSaved(false);
      setSpeaker("");
      setDismissed(false);
    }
  }, [state.status]);

  async function attachVoice(result: RecordingResult) {
    if (!state.saved) return;
    const form = new FormData();
    form.set("kind", state.saved.kind);
    form.set("itemId", state.saved.id);
    form.set("speakerLabel", speaker.trim() || "ich");
    form.set("durationMs", String(result.durationMs));
    form.set("audio", result.blob, `voice.${result.mimeType.split("/")[1]}`);
    await uploadRecording(form);
    setVoiceSaved(true);
    setRecording(false);
  }

  if (state.status === "saved" && state.saved && !dismissed) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
        <p className="flex items-start gap-2 font-medium">
          <Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <span>
            {state.saved.duplicate
              ? t("savedDuplicate", { slovene: state.saved.slovene })
              : t("saved", { slovene: state.saved.slovene })}
          </span>
        </p>
        {/* No priority boost, no deadline: it is simply part of the pile now. */}
        <p className="text-sm text-muted-foreground">{t("savedHint")}</p>

        {voiceSaved ? (
          <p className="text-sm text-primary">{tItem("recordingSaved")}</p>
        ) : recording ? (
          <div className="flex flex-col gap-3">
            <Label htmlFor="capture-speaker">{t("addVoice")}</Label>
            <Input
              id="capture-speaker"
              value={speaker}
              onChange={(event) => setSpeaker(event.target.value)}
              placeholder="Oma"
            />
            <SpeechRecorder
              labels={{
                start: t("addVoice"),
                stop: "OK",
                recording: "…",
                permissionDenied: t("saveFailed"),
                unsupported: t("saveFailed"),
                listenBack: "",
              }}
              onRecorded={(result) => void attachVoice(result)}
            />
          </div>
        ) : (
          <Button variant="outline" block onClick={() => setRecording(true)}>
            <Mic />
            {t("addVoice")}
          </Button>
        )}

        <div className="flex gap-3">
          {/* Straight back into an empty form: at a table there is usually a second one. */}
          <Button className="flex-1" onClick={() => setDismissed(true)}>
            {t("another")}
          </Button>
          <Button asChild variant="ghost">
            <Link href={`/teacher/items/${state.saved.kind}/${state.saved.id}`}>
              {t("more")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="slovene">{t("slovene")}</Label>
        <Input
          id="slovene"
          name="slovene"
          ref={sloveneRef}
          required
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
          placeholder={t("slovenePlaceholder")}
          className="slovene text-lg"
        />
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="german">{t("german")}</Label>
        <Input
          id="german"
          name="german"
          ref={germanRef}
          placeholder={t("germanPlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="contextNote">{t("contextNote")}</Label>
        <textarea
          id="contextNote"
          name="contextNote"
          ref={contextRef}
          rows={2}
          placeholder={t("contextPlaceholder")}
          className="min-h-20 w-full rounded-lg border border-input bg-card px-4 py-3 text-base"
        />
      </div>

      {assistAvailable ? (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void autofill()}
            disabled={assisting}
            className="self-start"
          >
            <Wand2 />
            {assisting ? t("assistRunning") : t("assist")}
          </Button>
          {/* Suggestions, and it says so. He reads them and presses save, or does not. */}
          <p className="text-sm text-muted-foreground">
            {assistError ? t("assistFailed") : (assistNote ?? t("assistHint"))}
          </p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
      >
        <ChevronDown
          className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden
        />
        {t("more")}
      </button>

      {expanded ? (
        <div className="flex flex-col gap-4 border-l-2 border-border pl-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="tags">{t("tags")}</Label>
            <Input id="tags" name="tags" placeholder={t("tagsPlaceholder")} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="register">{t("register")}</Label>
            <select
              id="register"
              name="register"
              ref={registerRef}
              defaultValue="standard"
              className="min-h-12 rounded-lg border border-input bg-card px-3 text-base"
            >
              {(["standard", "colloquial", "regional", "formal"] as const).map((value) => (
                <option key={value} value={value}>
                  {tRegister(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="regionLabel">{t("regionLabel")}</Label>
            <Input
              id="regionLabel"
              name="regionLabel"
              ref={regionRef}
              placeholder={t("regionPlaceholder")}
            />
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message === "missingSlovene" ? t("missingSlovene") : t("saveFailed")}
        </p>
      ) : null}

      <SaveButton label={t("save")} pendingLabel={t("saving")} />
    </form>
  );
}
