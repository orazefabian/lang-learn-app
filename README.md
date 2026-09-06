# Slovenščina

A self-hosted Slovene learning app for exactly two people: one learner (German
native speaker, absolute beginner) and one teacher. Built because no major
platform offers Slovene.

The design brief is in [`slovene-app-prompt.md`](./slovene-app-prompt.md). The
principles that constrain every decision: no streaks or guilt mechanics,
speaking first, a capped review backlog that is never dumped, real family
content over textbook dialogues, and deployment that works the same on a single
VPS or a k3s cluster.

## Status

Built in the order the brief lays out, kept runnable at each step.

| Step | Scope | State |
| ---- | ----- | ----- |
| 1 | Scaffold, Docker/compose, Postgres, schema, migrations, auth, i18n | done |
| 2 | Content model + seed import (1100-lemma deck, 39 lessons) | done |
| 3 | FSRS, card generation, review sessions | done |
| 4 | Piper TTS and the audio pipeline | done |
| 5 | Whisper ASR and speaking exercises | next |
| 6 | Lessons, home screen, progress view | |
| 7 | Teacher area: browser, quick-capture, recordings | |
| 8 | "Ask me" questions inbox | |
| 9 | AI generation with draft approval | |
| 10 | Weekly digest | |
| 11 | PWA and offline review | |
| 12 | K8s manifests, backups, E2E suite | |

## Stack

Next.js 16 (App Router, `output: "standalone"`) · TypeScript strict ·
PostgreSQL 17 · Drizzle ORM with checked-in SQL migrations · Tailwind CSS 4 ·
ts-fsrs (FSRS-5) · next-intl (German default, English fallback) · Piper for TTS ·
faster-whisper for ASR · Anthropic API for teacher-side content drafting ·
Vitest and Playwright.

## Getting started

Requires Node 22+ and pnpm (`corepack enable`), plus a PostgreSQL 17 database.

```bash
pnpm install
cp .env.example .env          # fill in SESSION_SECRET and DATABASE_URL
pnpm db:migrate               # or let the app migrate itself on startup
pnpm seed:users               # creates the two accounts
pnpm seed:content             # imports the deck and the curriculum as drafts
pnpm dev
```

`SESSION_SECRET` needs at least 32 characters — `openssl rand -base64 48`. The
server refuses to start without it; CLI scripts that only touch the database
need `DATABASE_URL` alone.

### Seeding content

`pnpm seed:content` imports the frequency deck and the curriculum from
[`seed/`](./seed/README.md). Everything lands as `draft`, so nothing reaches her
deck before it has been reviewed; `--activate` makes it live immediately.
Re-running is safe — items are matched on their normalised Slovene form and
updated in place, and every match is reported rather than silently skipped.

### Seeding the two accounts

`pnpm seed:users` reads `LEARNER_EMAIL` / `TEACHER_EMAIL` (and optional
`_NAME` / `_PASSWORD`) from the environment. A missing password is generated and
printed once. Re-running updates the existing accounts rather than duplicating
them. There is no public signup, by design.

### Without Docker

`pnpm dev:db` starts a wire-protocol-compatible Postgres in-process (PGlite) on
port 5432, so the app can run on a machine with no database installed. It is a
development convenience only — deploy against real PostgreSQL. It serves one
connection at a time, so set `DB_POOL_MAX=1` when the app points at it.

## Deployment

### Docker Compose (single host)

```bash
cp .env.example .env          # set POSTGRES_PASSWORD and SESSION_SECRET
docker compose up -d --build
docker compose exec app node scripts/seed-users.mjs
```

The app binds to `127.0.0.1:3000` and expects your existing reverse proxy and
certificate manager in front of it — none is bundled. Audio lives on the `media`
volume, the database on `db-data`.

Migrations run automatically at server startup (`src/instrumentation.ts`) and are
idempotent. Set `RUN_MIGRATIONS_ON_START=false` to manage them yourself.

Kubernetes manifests arrive with step 12.

### Health endpoints

- `GET /api/health` — liveness; the process is up.
- `GET /api/ready` — readiness; the database must answer. Piper and Whisper are
  reported but never gate readiness, because both are optional at runtime.

## Configuration

Every setting is an environment variable, documented in
[`.env.example`](./.env.example). Optional services degrade rather than crash:
no `PIPER_URL` means no generated audio, no `WHISPER_URL` means speaking
exercises fall back to self-assessment, no `ANTHROPIC_API_KEY` means the
teacher-side generation tool is unavailable.

## Content

The seed corpus is 1100 high-frequency lemmas with ~22 600 inflected forms,
built from OpenSubtitles frequencies, Sloleks 3.0 paradigms and German
Wiktionary glosses — all openly licensed, sources and caveats documented in
[`seed/README.md`](./seed/README.md).

On top of that sit 39 hand-written lessons across 10 units, sequenced for
talking to family: greetings, family, personal details, numbers and time, the
table, opinions, small talk, getting around, feelings, and telling a story about
yesterday. 26 plain-German grammar notes hang off the items that need them,
available on demand and never blocking practice.

## Domain model notes

Slovene is not treated as a generic language:

- **Dual number.** `grammatical_number` is `singular | dual | plural`
  everywhere, not a bolt-on.
- **Six cases, taught in conversational order.** The `grammatical_case` enum is
  ordered nominative → accusative → locative → genitive → dative →
  instrumental, which is the order the course introduces them, not the
  traditional table order.
- **Inflected forms are first-class.** `word_forms` stores one row per form with
  case, number, gender, person and verb-form columns plus the raw MSD tag, so a
  cloze exercise can ask for a specific slot instead of pattern-matching strings.
- **Aspect pairs** are a self-reference on `lexemes` (`aspect_partner_id`).
- **Register** is recorded per item (`standard | colloquial | regional |
  formal`) with a free-text region label, so real family speech can be labelled
  rather than corrected into textbook forms.
- **Cards, not items, are scheduled.** One lexeme or phrase produces several
  cards, one per exercise type, and FSRS schedules each independently.

## Spaced repetition

Cards, not items, are scheduled: one phrase produces a recognition card, a
production card, and — once the audio services exist — listening and speaking
cards, each with its own schedule.

The backlog rules are the part worth reading:

- A session queues at most `reviewCap` review cards (default 20) plus new
  material. When more is overdue, the rest waits and FSRS catches up over the
  following days.
- Oversized backlogs are ordered by how late a card is *relative to its own
  interval*, then by lowest stability, then oldest first. A two-day card two
  days late outranks a year-long card ten days late.
- **No screen ever shows a number above the cap.** The real count exists for
  the weekly digest, which is not her screen.
- New material is withheld entirely while more than
  `newMaterialBacklogThreshold` cards are overdue — silently, with no message
  about it.
- A card answered correctly forty days late gains stability rather than
  resetting. Coming back after two weeks is rewarded, not punished.

Session state — the queue and the cursor — lives in the database, so closing
the app mid-session loses nothing.

## Audio

Audio is generated when content is created or edited, never while she is
waiting for a card. Files live on the media volume, addressed by a hash of
(engine, voice, text) — so the same phrase is never synthesised twice, and an
edited phrase gets a new path automatically. Opus is stored for size with an
mp3 twin for compatibility.

```bash
pnpm audio:generate            # active content
pnpm audio:generate --drafts   # drafts too, to review before approving
```

**Human recordings always win.** When someone has recorded a phrase, that is
what plays; the generated voice becomes an alternate she can flick to. Hearing
the actual voices of the people she will talk to is the point, not a
nice-to-have.

The TTS service (`docker/piper`) is a thin HTTP wrapper around Piper that also
encodes, which keeps ffmpeg out of the deliberately slim Next.js image. It
synthesises once at startup and refuses to start if that fails, so a broken
image surfaces at deploy time rather than on her first listening card.

Listening cards show no text at all until she answers — the audio is the whole
prompt — and every card with audio keeps a replay and a 0.75x control.

## Known limitations

- **The scheduler is FSRS-6, not FSRS-5.** The brief asked for FSRS-5, but
  ts-fsrs 5.4.2 ships FSRS-6 as its default parameter set (21 weights instead of
  17). FSRS-6 is the successor from the same authors and is better calibrated,
  so the library default is used. Passing FSRS-5's weights to `createScheduler`
  pins the older model if that is ever wanted; nothing else changes.
- **Pitch accent and vowel length are not taught or graded.** They are real
  features of Slovene and no automatic scoring available here can judge them.
  The app provides good audio to imitate and stays quiet about the rest.
- **Whisper on Slovene is a word-recognition aid, not pronunciation feedback.**
  Results are framed as "verstanden als: …" and the learner can always override
  the automatic assessment. `WHISPER_MODEL` defaults to `medium` because `small`
  makes too many mistakes on a beginner speaking a low-resource language; `small`
  remains available for constrained hosts.
- **One Slovene TTS voice exists.** Piper ships exactly one `sl_SI` voice
  (`sl_SI-artur-medium`, single speaker, CC BY 4.0, trained on the
  [artur_studio_tts](https://huggingface.co/datasets/ppisljar/artur_studio_tts/)
  dataset). Voice variety therefore has to come from human recordings, which is
  the intent anyway.
- **Piper only runs in its container on this project's hardware.** The
  `piper-tts` 1.8.0 wheel for macOS x64 has a broken espeak-ng data path: the
  bundled phonemiser ignores the data directory it is given and looks for one
  baked in at build time, then exits. Piper's own CLI fails the same way, so it
  is the wheel, not this app. The Linux image sets `ESPEAK_DATA_PATH` explicitly
  and self-tests during the build. Practical effect: run `pnpm audio:generate`
  against the containerised Piper (`PIPER_URL=http://localhost:5000`), not
  against a locally pip-installed one on an Intel Mac.

## Development

```bash
pnpm typecheck        # tsc --noEmit, strict
pnpm test             # Vitest unit tests
pnpm test:integration # service layer against a real Postgres (PGlite)
pnpm test:e2e         # Playwright critical paths (from step 12)
pnpm db:generate   # regenerate SQL migrations after a schema change
```

Unit tests run the checked-in migrations against a real Postgres (PGlite,
in-process), so schema changes are validated without a running server. The
integration suite goes further and drives the review loop over the real wire
protocol.

Code, comments and identifiers are English. All user-facing copy lives in
`messages/de.json` with `messages/en.json` as fallback — no hardcoded strings.
