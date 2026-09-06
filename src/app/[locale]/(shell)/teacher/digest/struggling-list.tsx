"use client";

import { useState, useTransition } from "react";
import { Check, Mic, PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { SpeechRecorder, type RecordingResult } from "@/components/speech-recorder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import type { StrugglingItem } from "@/lib/digest/service";
import { uploadRecording } from "../actions";
import { saveItemNote } from "./actions";

/**
 * What is not sticking, and what to do about it.
 *
 * Both responses happen in place: record the item properly, or write down when
 * it is actually used. A list that could only be read would tell him something
 * is hard and leave him to go find it, which is the version of this feature
 * that never gets used.
 */
export function StrugglingList({ items }: { items: StrugglingItem[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.cardId}>
          <StrugglingRow item={item} />
        </li>
      ))}
    </ul>
  );
}

function StrugglingRow({ item }: { item: StrugglingItem }) {
  const t = useTranslations("teacher.digest");
  const [mode, setMode] = useState<"idle" | "record" | "note">("idle");
  const [speaker, setSpeaker] = useState("");
  const [note, setNote] = useState(item.contextNote ?? "");
  const [done, setDone] = useState<"voice" | "note" | null>(null);
  const [pending, start] = useTransition();

  async function attachVoice(result: RecordingResult) {
    const form = new FormData();
    form.set("kind", item.kind);
    form.set("itemId", item.itemId);
    form.set("speakerLabel", speaker.trim() || "ich");
    form.set("durationMs", String(result.durationMs));
    form.set("audio", result.blob, `voice.${result.mimeType.split("/")[1] ?? "webm"}`);
    await uploadRecording(form);
    setDone("voice");
    setMode("idle");
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <p className="slovene text-lg leading-snug">{item.slovene}</p>
        <p className="text-sm text-muted-foreground">{item.german}</p>
        <p className="text-xs text-muted-foreground">
          {t("itemStats", { lapses: item.lapses, reps: item.reps })}
          {item.hasHumanAudio ? "" : ` · ${t("noVoiceYet")}`}
        </p>
      </div>

      {done ? (
        <p className="flex items-center gap-2 text-sm text-primary" role="status">
          <Check className="size-4" aria-hidden />
          {done === "voice" ? t("voiceSaved") : t("noteSaved")}
        </p>
      ) : mode === "record" ? (
        <div className="flex flex-col gap-2">
          <Input
            value={speaker}
            onChange={(event) => setSpeaker(event.target.value)}
            placeholder={t("speakerPlaceholder")}
            aria-label={t("speaker")}
          />
          <SpeechRecorder
            labels={{
              start: t("record"),
              stop: "OK",
              recording: "…",
              permissionDenied: t("recordFailed"),
              unsupported: t("recordFailed"),
              listenBack: "",
            }}
            onRecorded={(result) => void attachVoice(result)}
          />
        </div>
      ) : mode === "note" ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            autoFocus
            placeholder={t("notePlaceholder")}
            aria-label={t("note")}
            className="min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await saveItemNote({ kind: item.kind, id: item.itemId, note });
                  setDone("note");
                  setMode("idle");
                })
              }
            >
              {t("saveNote")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setMode("record")}>
            <Mic />
            {t("record")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("note")}>
            <PenLine />
            {item.contextNote ? t("editNote") : t("note")}
          </Button>
          <Link
            href={`/teacher/items/${item.kind}/${item.itemId}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("openItem")}
          </Link>
        </div>
      )}
    </div>
  );
}
