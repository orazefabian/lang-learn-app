import type { DigestData } from "./service";

/**
 * The digest as an email.
 *
 * Plain text carries the whole thing; the HTML part is the same content with
 * spacing. Both are German, both are factual, and neither contains a call to
 * action aimed at her — it goes to one person, who is the one who acts on it.
 */

export type RenderedEmail = { subject: string; text: string; html: string };

const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });

function percent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)} %`;
}

function line(label: string, value: string | number): string {
  return `${label}: ${value}`;
}

export function renderDigestEmail(input: {
  subjectName: string;
  data: DigestData;
  appUrl?: string;
}): RenderedEmail {
  const { data, subjectName } = input;
  const start = new Date(data.period.start);
  const end = new Date(data.period.end);
  const range = `${dateFormat.format(start)}–${dateFormat.format(end)}`;

  const subject = `Slovenščina: Woche ${range}`;

  const blocks: string[] = [];

  blocks.push(
    [
      `Woche ${range} — ${subjectName}`,
      "",
      line("Wiederholungen", data.reviewed.total),
      line("Karten", data.reviewed.distinctCards),
      line("Tage mit Übung", data.reviewed.activeDays),
      line("Behalten (reife Karten)", percent(data.retention.rate)),
      line("Neu angefangen", data.learned.newCardsStarted),
      line("Lektionen fertig", data.learned.lessonsCompleted),
      line("Kann sie sagen (gesamt)", data.learned.canSayTotal),
    ].join("\n"),
  );

  if (data.daysSinceLastSession !== null) {
    blocks.push(
      data.daysSinceLastSession === 0
        ? "Zuletzt geübt: heute."
        : `Zuletzt geübt: vor ${data.daysSinceLastSession} Tagen.`,
    );
  }

  if (data.struggling.length) {
    blocks.push(
      [
        "Was gerade hakt:",
        ...data.struggling.map((item, index) => {
          const voice = item.hasHumanAudio ? "" : " — noch keine Stimme";
          return `${index + 1}. ${item.slovene} (${item.german}) · ${item.lapses}× vergessen${voice}`;
        }),
      ].join("\n"),
    );
  }

  if (data.speech.lowest.length) {
    blocks.push(
      [
        "Aussprache, niedrigste Werte:",
        ...data.speech.lowest.map((attempt) => {
          const heard = attempt.transcript ? `verstanden: „${attempt.transcript}“` : "nichts verstanden";
          return `- ${attempt.targetText} → ${heard}`;
        }),
      ].join("\n"),
    );
  }

  if (data.openQuestions.length) {
    blocks.push(
      [
        "Offene Fragen:",
        ...data.openQuestions.map((question) => {
          const age = question.ageDays === 0 ? "heute" : `seit ${question.ageDays} Tagen`;
          return `- ${question.slovene}${question.body ? `: ${question.body}` : ""} (${age})`;
        }),
      ].join("\n"),
    );
  }

  if (input.appUrl) blocks.push(`Im Lehrbereich: ${input.appUrl}/teacher/digest`);

  const text = blocks.join("\n\n");

  const html = [
    '<div style="font-family:system-ui,sans-serif;line-height:1.5;max-width:34rem">',
    ...blocks.map(
      (block) =>
        `<p style="white-space:pre-wrap;margin:0 0 1.25rem">${block
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</p>`,
    ),
    "</div>",
  ].join("");

  return { subject, text, html };
}
