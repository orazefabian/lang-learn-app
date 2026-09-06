"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowUp, Mic, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { SpeechRecorder, type RecordingResult } from "@/components/speech-recorder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useRouter } from "@/i18n/navigation";
import { mediaUrl } from "@/lib/audio/resolve";
import type { ContentDetail } from "@/lib/teacher/content";
import { cn } from "@/lib/utils";
import {
  archiveContentItem,
  deleteRecording,
  makePrimaryRecording,
  saveContentItem,
  uploadRecording,
} from "../../../actions";

/**
 * Editing one item, and attaching voices to it.
 *
 * The recording half is the part that matters: a phrase with someone's real
 * voice on it is worth more than the same phrase with a perfect gloss, because
 * the voice is what she will actually hear at the table.
 */
export function ItemEditor({ item }: { item: ContentDetail }) {
  const t = useTranslations("teacher.item");
  const tRegister = useTranslations("teacher.registerLabel");
  const tStatus = useTranslations("teacher.statusLabel");
  const router = useRouter();

  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speaker, setSpeaker] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectClass = "min-h-12 rounded-lg border border-input bg-card px-3 text-base";

  function save(formData: FormData) {
    startTransition(async () => {
      await saveContentItem(formData);
      setSaved(true);
      router.refresh();
    });
  }

  function attach(blob: Blob, mimeType: string, durationMs?: number) {
    if (!speaker.trim()) {
      setError(t("speakerRequired"));
      return;
    }
    setError(null);

    const form = new FormData();
    form.set("kind", item.kind);
    form.set("itemId", item.id);
    form.set("speakerLabel", speaker.trim());
    if (durationMs) form.set("durationMs", String(durationMs));
    form.set("audio", blob, `voice.${mimeType.split("/")[1] ?? "webm"}`);

    startTransition(async () => {
      try {
        await uploadRecording(form);
        setRecording(false);
        setSpeaker("");
        router.refresh();
      } catch {
        setError(t("uploadFailed"));
      }
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-8 px-5 pb-10 pt-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/teacher/content"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {t("back")}
        </Link>
        <h1 className="slovene text-2xl leading-snug">{item.slovene}</h1>
        <p className="text-sm text-muted-foreground">
          {item.inDeck ? t("inDeck") : t("notInDeck")}
        </p>
      </div>

      <form action={save} className="flex flex-col gap-4">
        <input type="hidden" name="kind" value={item.kind} />
        <input type="hidden" name="id" value={item.id} />

        <div className="flex flex-col gap-2">
          <Label htmlFor="slovene">{t("slovene")}</Label>
          <Input
            id="slovene"
            name="slovene"
            defaultValue={item.slovene}
            required
            className="slovene text-lg"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="german">{t("german")}</Label>
          <Input id="german" name="german" defaultValue={item.german} />
          {item.kind === "lexeme" ? (
            <p className="text-xs text-muted-foreground">{t("germanHint")}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="contextNote">{t("contextNote")}</Label>
          <textarea
            id="contextNote"
            name="contextNote"
            rows={3}
            defaultValue={item.contextNote ?? ""}
            className="min-h-24 w-full rounded-lg border border-input bg-card px-4 py-3 text-base"
          />
          {/* This is the line she reads on the card, so it is worth getting right. */}
          <p className="text-xs text-muted-foreground">{t("contextHint")}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="register">{t("register")}</Label>
            <select
              id="register"
              name="register"
              defaultValue={item.register}
              className={selectClass}
            >
              {(["standard", "colloquial", "regional", "formal"] as const).map((value) => (
                <option key={value} value={value}>
                  {tRegister(value)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="status">{t("status")}</Label>
            <select
              id="status"
              name="status"
              defaultValue={item.status}
              className={selectClass}
            >
              {(["active", "draft", "archived"] as const).map((value) => (
                <option key={value} value={value}>
                  {tStatus(value)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="regionLabel">{t("regionLabel")}</Label>
            <Input id="regionLabel" name="regionLabel" defaultValue={item.regionLabel ?? ""} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tags">{t("tags")}</Label>
            <Input id="tags" name="tags" defaultValue={item.tags.join(", ")} />
          </div>
        </div>

        <Button type="submit" size="lg" block disabled={pending}>
          {t("save")}
        </Button>
        {saved ? <p className="text-center text-sm text-primary">{t("saved")}</p> : null}
      </form>

      <section className="flex flex-col gap-4 border-t border-border pt-6">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t("audioTitle")}
        </h2>

        {item.audio.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRecordings")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {item.audio.map((asset) => (
              <li
                key={asset.id}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-3",
                  asset.kind === "human_recording" ? "border-accent" : "border-border",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    {asset.kind === "human_recording"
                      ? (asset.speakerLabel ?? "—")
                      : t("generatedVoice")}
                  </span>
                  {asset.kind === "human_recording" ? (
                    <span className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("makePrimary")}
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            await makePrimaryRecording({ assetId: asset.id });
                            router.refresh();
                          })
                        }
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("deleteRecording")}
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            await deleteRecording({ assetId: asset.id });
                            router.refresh();
                          })
                        }
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </span>
                  ) : null}
                </div>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio controls preload="none" className="h-9 w-full">
                  <source src={mediaUrl(asset.path)} />
                  {asset.fallbackPath ? <source src={mediaUrl(asset.fallbackPath)} /> : null}
                </audio>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="speakerLabel">{t("speakerLabel")}</Label>
            <Input
              id="speakerLabel"
              value={speaker}
              onChange={(event) => setSpeaker(event.target.value)}
              placeholder={t("speakerPlaceholder")}
            />
          </div>

          {recording ? (
            <SpeechRecorder
              labels={{
                start: t("addRecording"),
                stop: t("saveRecording"),
                recording: t("addRecording"),
                permissionDenied: t("uploadFailed"),
                unsupported: t("uploadFailed"),
                listenBack: t("audioTitle"),
              }}
              disabled={pending}
              onRecorded={(result: RecordingResult) =>
                attach(result.blob, result.mimeType, result.durationMs)
              }
            />
          ) : (
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setRecording(true)}>
                <Mic />
                {t("addRecording")}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => fileRef.current?.click()}
              >
                <Upload />
                {t("uploadFile")}
              </Button>
            </div>
          )}

          {/* Uploading matters as much as recording: old voice notes count too. */}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) attach(file, file.type || "audio/mpeg");
              event.target.value = "";
            }}
          />

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-6">
        <Button
          variant={item.status === "archived" ? "outline" : "ghost"}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await archiveContentItem({
                kind: item.kind,
                id: item.id,
                archived: item.status !== "archived",
              });
              router.refresh();
            })
          }
        >
          {item.status === "archived" ? t("unarchive") : t("archive")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("archiveHint")}</p>
      </section>
    </main>
  );
}
