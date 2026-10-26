@AGENTS.md

# Dober dan — working guide

A self-hosted Slovene learning app for exactly two people: one learner (German
native, beginner) and one teacher. Next.js 16 App Router, TypeScript strict,
PostgreSQL + Drizzle, next-intl, ts-fsrs, Piper (TTS), faster-whisper (ASR),
Anthropic API (teacher-side drafting only).

- `README.md` is the design record: *why* each feature works the way it does.
  Read the section for the area you are touching before changing it.
- `slovene-app-prompt.md` is the original brief. Its "Design principles" win
  over convenience, over a reviewer's suggestion, and over an issue's wording.

## Product rules — a change that breaks one of these is a bug

1. **No guilt mechanics.** No streaks, daily goals, consecutive-day counters,
   lives, "you missed…" copy, or red/scoreboard colours. Coming back after weeks
   must feel like a welcome. Progress is shown only as what she *can say*.
2. **The backlog is capped and never dumped.** No learner-facing screen shows a
   due count above `reviewCap` — use `displayDueCount()` from
   `src/lib/srs/queue.ts`. The real number is for the teacher (digest, teacher
   progress view) only. New material is withheld silently when the backlog is
   large; never tell her so.
3. **AI content is always `status: "draft"`** and has no cards. The only code
   path that creates cards for AI content is teacher approval
   (`src/lib/ai/review.ts`). `tests/integration/generation.test.ts` asserts it.
4. **Human recordings outrank TTS** wherever audio plays
   (`src/lib/audio/resolve.ts`). Answer voice notes are *not* media assets for
   the item — a teacher explaining grammar must never play as a model voice.
5. **Optional services degrade, never crash.** Piper, Whisper, Anthropic and
   SMTP may be absent. Gate on `isTtsConfigured()` / `isAsrConfigured()` /
   `isAiConfigured()` from `src/lib/env.ts`; the feature disappears or falls
   back (speaking → self-assessment), nothing errors.
6. **The recogniser reports what it heard, never a verdict.** Speaking results
   are "verstanden als: …" plus a word diff; she always taps the rating herself.
7. **Sessions survive being closed mid-card.** Session state lives in the DB.
   Offline answers carry client-minted ids and replay with *her* timestamps,
   oldest first — never double-apply, never re-time.
8. **Slovene is not a generic language.** Dual number, six cases in teaching
   order, aspect pairs and register are modelled explicitly
   (`src/db/schema/enums.ts`). Don't flatten them to fit a generic shape.
9. **Teacher routes reject the learner** (`requireTeacher()`), and teacher
   copy may show numbers her screens must not.

## Commands

Node 24 (`.nvmrc`), pnpm 12 (`corepack enable`; if pnpm is missing, `npx
pnpm@12.3.4 <cmd>` works). Every script reads `.env` itself.

```bash
pnpm check              # typecheck + lint + unit tests — run before every commit
pnpm test:integration   # service layer against PGlite over the wire (~20 s)
pnpm dev                # needs DATABASE_URL + SESSION_SECRET (32+ chars)
pnpm dev:db             # in-process Postgres on :5432 — set DB_POOL_MAX=1
pnpm db:generate        # SQL migration from a schema change (see schema skill)
pnpm ux:verify ...      # before/after screenshots + a11y diff (see ux skill)
```

Single test: `pnpm vitest run tests/unit/srs-queue.test.ts`, or `-t "name"`.
E2E (`pnpm test:e2e`) needs real Postgres and a browser — see
`tests/e2e/README.md`.

## Where things live

```
src/app/[locale]/(shell)/   pages with the bottom nav (home, lessons, progress, teacher/*)
src/app/[locale]/review/    full-screen review session — deliberately no nav
src/app/[locale]/lessons/[slug]/  full-screen lesson player
src/app/api/                health/ready, media streaming, offline bundle + sync
src/lib/<domain>/           all business logic, one folder per domain
src/db/schema/              Drizzle tables, split by area; enums.ts holds every enum
src/components/             shared client components; ui/ is the shadcn-style kit
messages/{de,en}.json       every user-facing string
seed/curriculum/*.json      the 39 hand-written lessons (validated by src/lib/seed/schemas.ts)
drizzle/                    checked-in SQL migrations, run at server boot
public/sw.js                hand-written service worker
tests/unit/                 pure logic + migrations + manifests + message catalogs
tests/integration/          services against PGlite (helpers/database.ts)
scripts/ux/                 the UX harness (screenshots, axe, before/after)
```

## How code is shaped here

**Layers.** Page / server action → `src/lib/<domain>` service → Drizzle.
- Pages and actions are thin: authenticate, parse input with Zod, call one
  service, `revalidatePath`, return. Model: `src/app/[locale]/(shell)/teacher/actions.ts`.
- Services take `db: Db` as their first argument instead of importing the `db`
  singleton (only `src/lib/auth/*` does that, because it runs per request), and
  take `now = new Date()` as a parameter when time matters.
  That is what makes them testable against PGlite with a fixed clock.
  Model: `src/lib/teacher/progress.ts`.
- Pure logic (scheduling, scoring, comparison, queue building) lives in
  functions with no DB access, so it can be unit-tested. Keep it that way.

**Every page** awaits `params`, calls `setRequestLocale(locale)`, then
`requireUser()` / `requireTeacher()`. **Every server action** calls
`requireUser()` / `requireTeacher()` first — the proxy does *not* authenticate
(`src/proxy.ts` is locale negotiation only, and is named `proxy` because Next 16
renamed middleware).

**i18n.** No hardcoded user-facing strings, anywhere. Add keys to *both*
`messages/de.json` and `messages/en.json` (a unit test enforces parity). Server:
`getTranslations("ns")`; client: `useTranslations("ns")`. Navigate with `Link`,
`redirect`, `useRouter` from `@/i18n/navigation`, not `next/link`. URLs are
always locale-prefixed (`localePrefix: "always"` — "as-needed" causes a redirect
loop in production builds; don't change it). Server actions return error
*keys* (`"missingSlovene"`), and the component translates them.

**Typography.** Slovene text gets `className="slovene"` (Fraunces); German and
UI use the default sans (Atkinson). Items that turn on the dual get
`dual-mark`. Colours come from the tokens in `src/app/globals.css` — no raw hex
or Tailwind palette colours (`text-red-500`; the viewport `themeColor` is the
one place literals are required), and check dark mode.

**Config.** Read settings through `env()` from `src/lib/env.ts`, never
`process.env` directly (instrumentation is the one exception). A new variable
goes in the Zod schema *and* `.env.example` with a comment, and — if it is
deployed — `k8s/config.yaml` or `k8s/secret.example.yaml`
(`tests/unit/k8s-manifests.test.ts` checks secret references).

**Logging.** `logger` from `src/lib/logger.ts` (pino, structured):
`logger.warn({ err: error, itemId }, "what failed")`. No `console.log` in `src/`.

**Comments** explain *why* — the constraint, the incident, the trade-off — in
full sentences, like the existing ones. Don't narrate what the code does.

## Gotchas

- **This is Next 16.** Check `node_modules/next/dist/docs/` before using an API
  from memory: `next lint` is gone (we use `eslint .`), middleware is `proxy.ts`,
  `params`/`searchParams`/`cookies()` are async.
- **Migrations run automatically at boot** (`src/instrumentation.ts`) against
  her real history. They must be additive and backward compatible. Never edit
  a migration that is already on `main`. Use the `schema-change` skill.
- **PGlite serves one connection.** With `pnpm dev:db`, set `DB_POOL_MAX=1` and
  stop the app before running a CLI script against it.
- **Integration tests set env before importing app modules** — they use
  `await import("@/db/client")` inside `beforeAll`, because `env()` and the
  pool are created on first import. Copy that shape.
- **The service worker never caches** `/api/offline/*`, server actions, or
  `/teacher`. When `SHELL_ASSETS` changes, bump `VERSION` in `public/sw.js`.
- **Generated files — don't hand-edit:** `drizzle/meta/*` (drizzle-kit),
  `seed/frequency-*.json` (`pnpm seed:build-deck`), `public/icons/*`
  (`pnpm icons:build`), `scripts/dist/` (`pnpm ops:build`).
- **`.env` is real config**; `.env.example` is the documentation. Blank values
  mean "unset" by design.
- **AGENTS.md is managed by `next dev`.** It re-inserts its block on every
  start; leave that block alone and put project guidance here.

## Workflow

- Branch from `main`: `feat/…`, `fix/…`, `chore/…`. Commit or push only when
  asked.
- Commit messages match the history: an imperative sentence as the subject
  ("Give the turtle button a real slow rendition"), then prose explaining what
  was wrong and why this fix — not a file list.
- When behaviour changes, update the matching `README.md` section in the same
  change, and keep its "Known limitations" honest: if you could not run
  something (a browser, a container, a real API call), say so there and in the
  PR.
- UI changes get a before/after from the UX harness in the PR description.
- Done means: `pnpm check` green, `pnpm test:integration` green if you touched
  `src/lib` or `src/db`, new behaviour has a test, README updated, PR template
  filled in.

## Skills

Project skills in `.claude/skills/` — load the one that matches the task:

| Skill | Use it when |
| ----- | ----------- |
| `feature-slice` | adding or changing a screen, server action or service end to end |
| `schema-change` | touching `src/db/schema` — migration, safety rules, tests |
| `copy-and-i18n` | adding or changing any user-facing text |
| `curriculum-content` | adding or editing lessons, units, phrases or grammar notes |
| `ux-verify` | any visible UI change — before/after screenshots and a11y diff |
| `pre-pr-check` | before opening a PR — gates, product-rule review, PR body |
