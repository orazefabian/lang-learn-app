---
name: copy-and-i18n
description: Write or change user-facing text — German UI copy in messages/de.json with its English fallback, ICU plurals, and the app's no-guilt tone. Use for any new string, label, empty state, error message, button, or notification, and when reviewing copy in a diff.
---

# Copy and i18n

Every word on screen lives in `messages/de.json` (what she reads) and
`messages/en.json` (the fallback merged underneath it by `src/i18n/request.ts`).
A key missing from `de` doesn't crash — it silently shows English, so
`tests/unit/messages.test.ts` enforces that both files have the same keys and
the same ICU arguments.

## Mechanics

1. Pick the namespace that matches the screen (`home`, `review`, `lessons`,
   `progress`, `teacher.<area>`, `offline`, `errors`, `common`, `nav`, `auth`).
   Nest by screen, then by element: `teacher.progress.lastDaysAgo`.
2. Add the key to **both** files at the same path, same arguments.
3. Use it:
   - server component: `const t = await getTranslations("teacher.progress")`
   - client component: `const t = useTranslations("review")`
   - dynamic sub-keys need a cast for the typed API:
     `t(\`lessonStatus.${status}\` as "lessonStatus.completed")`
4. Plurals are ICU, always with an explicit `=1` (German reads better with a
   word than a digit for one):
   `"{count, plural, =1 {Eine Karte} other {# Karten}}"`.
   Add `=0` when zero needs its own sentence rather than "0 Sätze".
5. Server actions return error **keys** (`"missingSlovene"`); the component
   maps them to `t(...)`. Never put German in an action or a service.
6. `pnpm vitest run tests/unit/messages.test.ts`.

Never hardcode a string in JSX, `aria-label`, `title`, `alt`, `placeholder`, a
toast, or metadata — screen-reader text counts too (`sr-only` spans are copy).

## Voice — learner screens

- **Du**, warm, short, plain. She is an adult beginner, not a child and not a
  customer. "Schön, dass du da bist." not "Willkommen zurück! 🎉".
- **No guilt, no pressure, no scoreboard.** Never: streaks, "verpasst",
  "schon X Tage", "du solltest", "nur noch", "Ziel", "Rückstand", counts of
  what she has *not* done, exclamation-mark cheerleading. Absence is met with a
  welcome; a backlog is never mentioned (the session is just smaller).
- **Mistakes are information, not failure.** Wrong answer: "Noch nicht", not
  "Falsch". The recogniser *understood* something ("verstanden als: …"); it
  never judges pronunciation.
- **Optional, not obligatory**: "Wenn du magst, lern etwas Neues."
- The teacher is "er" in her copy ("sobald er etwas beantwortet").
- Slovene examples inside German copy go in *italics* in grammar notes; in
  JSX, Slovene is a separate element with `className="slovene"`, not inlined
  into a German string.

## Voice — teacher screens

- Matter-of-fact and terse. When addressing him it is also **du** ("Claude
  schlägt vor, du entscheidest."); the learner is "sie" / `{name}`.
- Teacher screens may show real numbers her screens never show (overdue
  count, lapses) — report, don't characterise. "Zuletzt aktiv: vor 9 Tagen."
  not "Seit 9 Tagen inaktiv!". The digest must never read as a nag he would
  relay to her.

## English fallback

A faithful, natural translation of the German — same arguments, same tone,
same restraint. It's what shows if a German key goes missing, so it must
never be a placeholder like `"TODO"` or the key name.

## Review checklist for a copy diff

- [ ] Key present in both files, same arguments (test passes)
- [ ] No hardcoded string left in the component, including aria/alt/sr-only
- [ ] Learner copy has no count above the review cap and no guilt vocabulary
- [ ] Empty state has its own sentence
- [ ] Plural uses ICU with `=1`
