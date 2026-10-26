---
name: feature-slice
description: Build or change a feature end to end in this app — page, server action, domain service, copy, tests and README — following the repo's layering. Use when adding a screen, a form, a server action, a teacher tool, or new behaviour in src/lib; also when an issue asks for "a way to do X" in the app.
---

# Building a feature slice

The app is layered: **page / server action → `src/lib/<domain>` service →
Drizzle**. Most bugs this repo has had came from skipping a layer (logic in a
component), skipping a guard (auth in an action), or skipping the copy rules.
Work through the steps in order.

## 0. Decide where it belongs

- Read the `README.md` section for the area, and the product rules in
  `CLAUDE.md`. If the feature touches what the learner sees about her progress
  or backlog, re-read rules 1 and 2 before designing anything.
- Learner screen with the bottom nav → `src/app/[locale]/(shell)/<route>/`.
  Teacher screen → `src/app/[locale]/(shell)/teacher/<route>/`.
  A one-thing-at-a-time flow (like review, lesson player) sits *outside*
  `(shell)` on purpose — no nav means no invitation to leave mid-card.
- Logic goes in an existing domain folder under `src/lib/` if one fits
  (`srs`, `lessons`, `progress`, `teacher`, `questions`, `audio`, `speech`,
  `digest`, `offline`, `ai`, `session`). Create a new folder only for a new
  domain.
- New table or column? Do the `schema-change` skill first.

## 1. The service (`src/lib/<domain>/*.ts`)

```ts
import type { Db } from "@/db/client";

export async function getThing(db: Db, userId: string, now = new Date()): Promise<Thing> { … }
```

- `db: Db` first, injected — never `import { db }` here.
- Take `now` as a parameter whenever time affects the result.
- Put pure computation (ranking, scoring, formatting decisions) in separate
  exported functions with no DB access, so they get unit tests.
- Return plain data shaped for the caller; dates as `Date` or ISO strings,
  consistently within one type.
- Optional services: check `isTtsConfigured()` / `isAsrConfigured()` /
  `isAiConfigured()` and return a degraded result, never throw because a
  service is missing. Background side effects (audio generation) are
  fire-and-forget with a logged warning:
  `void ensureTtsAudio(db, …).catch((err) => logger.warn({ err }, "…"))`.

Model: `src/lib/teacher/progress.ts`.

## 2. The server action (`actions.ts` next to the page)

```ts
"use server";
export async function doThing(_prev: State, formData: FormData): Promise<State> {
  const user = await requireUser();          // or requireTeacher() — ALWAYS first
  const parsed = schema.safeParse({ … });     // Zod; trim strings, "" → undefined
  if (!parsed.success) return { status: "error", message: "invalidInput" }; // an i18n key
  try {
    await serviceCall(db, user.id, parsed.data);
  } catch (error) {
    logger.error({ err: error }, "doing the thing failed");
    return { status: "error", message: "saveFailed" };
  }
  revalidatePath("/affected/route");          // every route whose data changed
  return { status: "saved" };
}
```

- Auth first, every time. `src/proxy.ts` does not authenticate.
- Validate everything from `FormData` with Zod; uuids with `z.string().uuid()`.
- Return i18n *keys* for errors; the component translates them.
- Audio uploads: check the MIME type against the allow-list pattern in
  `src/app/[locale]/(shell)/teacher/actions.ts`; body limit is 12 MB
  (`next.config.ts`).
- `revalidatePath` without the locale prefix, for every view the change makes
  stale (teacher hub badges included).

Model: `src/app/[locale]/(shell)/teacher/actions.ts`.

## 3. The page (`page.tsx`, a server component)

```tsx
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser();        // requireTeacher() for teacher routes
  const t = await getTranslations("namespace");
  const data = await getThing(db, user.id);
  return <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pb-10 pt-8">…</main>;
}
```

- Exactly one `<h1>` per screen (the UX harness flags `page-has-heading-one`).
- Phone-first: `max-w-md`, thumb-reachable actions at the bottom, large tap
  targets.
- Slovene text: `className="slovene"`. Dual items: `dual-mark`. Colours from
  tokens (`bg-card`, `text-muted-foreground`, `border-border`, `bg-primary`,
  `bg-accent-soft`), never palette classes. Check dark mode.
- Links: `Link` from `@/i18n/navigation`.
- Empty states get their own copy — not a hint repurposed, not a blank area.

## 4. Client components

- Only where interaction needs it (`"use client"`), as small as possible,
  in a file next to the page (`thing-form.tsx`).
- `useTranslations("namespace")` for copy, or receive translated `labels`
  as props from the server component (pattern in `src/components/speech-recorder.tsx`).
- Forms: `useActionState(action, initialState)`.
- No `setState` directly in an effect body, no `Date.now()` during render, no
  reading `ref.current` during render — the lint rules warn about existing
  cases; don't add new ones.
- Anything the learner does during a review must also work offline — read
  `README.md` → "Offline" before touching `review/`.

## 5. Copy

Load the `copy-and-i18n` skill. Every string in both `messages/de.json` and
`messages/en.json`.

## 6. Tests

- Pure logic → `tests/unit/<area>.test.ts`. Fixed `NOW`, small builders.
  Model: `tests/unit/srs-queue.test.ts`.
- Service → `tests/integration/<area>.test.ts` against PGlite. Set env vars
  first, then `await import(...)` app modules inside `beforeAll` — the env and
  pool are created on first import. Model: `tests/integration/teacher-progress.test.ts`.
- Assert the product rule the feature could break, not just the happy path
  (e.g. "the learner's count never exceeds the cap", "a draft has no cards").
- Stub Piper / Whisper / Anthropic behind their interfaces; never call them.

```bash
pnpm check
pnpm test:integration
```

## 7. Finish

- Visible change → `ux-verify` skill for before/after.
- Update the `README.md` section the behaviour lives in (the README is the
  design record; feature commits here always touch it).
- Then `pre-pr-check`.
