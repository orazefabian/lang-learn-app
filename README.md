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
| 5 | Whisper ASR and speaking exercises | done |
| 6 | Lessons, home screen, progress view | done |
| 7 | Teacher area: browser, quick-capture, recordings | done |
| 8 | "Ask me" questions inbox | done |
| 9 | AI generation with draft approval | next |
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

## Speaking

She records, the audio is stored, and the recogniser reports **what it
understood** — never a verdict on her pronunciation. The result is framed as
*verstanden als: …* with a word-level diff showing which words differed, and
she taps the rating herself. A misheard word therefore costs her nothing.

The recording is kept whatever happens to the recogniser:

| Whisper | What happens |
| --- | --- |
| answering | transcript, band, and diff; a rating is suggested |
| starting up or down | attempt stays `pending`, card falls back to self-assessment, scored on the next sync |
| genuinely broken | attempt marked `failed`, audio still stored for the teacher |

Every attempt is retained by default — it is two users — so the teacher can
listen back to any of them later.

The app records whether she agreed with the suggestion (`auto_speech`) or
overruled it (`overridden`). That is not used to change anything; it is there so
there is evidence before anyone decides to trust the recogniser more.

### Health

`GET /api/ready` reports each optional service as `absent` (not configured),
`reachable`, or `unreachable` (configured but not answering). Neither gates
readiness — the app is healthy without them, just quieter.

## The app she uses

Four screens, phone-first, bottom navigation because the top of a phone is the
part a thumb cannot reach.

**Home** offers both ways in, always: the capped review count and the next
lesson. Reviews never depend on lessons and lessons never depend on reviews.
Below them sits the beginning of the capability list.

**Lessons** are a short guided sequence — the item, its audio, when you would
say it, then one low-stakes try that is explicitly marked as not counting.
Finishing is what hands the items to the scheduler. Lessons are ordered but
never gated: opening one out of sequence shows a warning that says it is fine
and offers a way back, not a locked door.

**"Was ich sagen kann"** is the progress view, and the only progress this app
keeps. It is a phrasebook page that fills up: each sentence she can now say,
newest first, in Slovene with its German underneath and the context note that
made it stick. A phrase appears once its production or speaking card holds a
week of stability — seen once is not the same as able to say it. There are no
streaks, no daily goals and no consecutive-day counters anywhere in the app.

### Design

Two typefaces, one job each: **Fraunces** sets Slovene, **Atkinson
Hyperlegible** sets German and the interface. The split is not decoration —
it tells her at a glance which language she is looking at, and Atkinson was
drawn for legibility, which is what the language she already reads needs. Both
are self-hosted at build time, so no request leaves the server at runtime.

The palette comes from karst limestone and *panjske končnice*, the painted
beehive panels of Slovene folk art: pale cool stone, blue-black ink, one ochre
accent, and an iron red kept for the single place that needs weight. Nothing in
it is a scoreboard colour, because there is no score.

The dual gets its own mark — a pair of dots — on the lessons, cards and phrases
that turn on it. Slovene counts to two before it counts to many, and that is
the one thing about the language worth putting a glyph on.

## The teacher area

Same app, same URL, one extra tab that only appears for the teacher account —
so he can sit next to her and switch views on his own phone. Every teacher route
turns a learner away rather than rendering.

**Quick capture** is built for the ten seconds between hearing something at a
family dinner and losing it: the Slovene field is focused on load, only that
field is required, and everything else folds away. After saving it offers to
record a voice for it immediately, and then an empty form again, because at a
table there is usually a second phrase coming.

Captured items go live at once — unlike AI drafts, which wait for approval. The
teacher heard it said; that is the review. They join the pile with **no priority
boost and no deadline**: same `new` state, same due time, same daily limit as
everything else.

**Human recordings** attach to any item, by recording in the browser or
uploading a file, each with a speaker label — "Oma", "Papa", "ich". A recording
always outranks the generated voice on her card, and the rest stay available as
alternates. The teacher hub lists the active items nobody has recorded yet,
which is the natural working queue.

**The content browser** searches Slovene, German and context notes, including
without diacritics — `bos se` finds `Boš še?`. Filters live in the URL, so a
filtered view survives an edit and can be bookmarked. Archiving suspends the
learner's cards instead of deleting them: her review history stays intact and
un-archiving puts the item back exactly where it was.

Editing the Slovene marks the audio stale and regenerates it, since the media
store is keyed by a hash of the text.

## Asking a question

Every card carries an unobtrusive **"Verstehe ich nicht"**. Tapping it opens a
small box for optional text; sending is fire-and-forget, so the confirmation
appears at once and the session never waits on the network. Being stuck should
cost a tap, not her momentum. A question with no text is perfectly valid — the
card alone says where she got stuck.

The teacher answers with text, a voice note, or both. Explaining a case ending
out loud takes ten seconds and typing it takes two minutes, so recording is one
tap rather than a menu.

**The answer attaches to the item, not the card.** It shows on every card for
that item from then on — recognition, listening, cloze — and survives the card
being rebuilt, because the question stores the phrase and lexeme references
alongside the card it came from.

Answer audio is deliberately *not* linked to the item as a media asset. An
answer is an explanation, not a model pronunciation; attaching it would put the
teacher explaining the accusative into the rotation of voices her listening
cards play back. There is a test for exactly that.

Her side gets one notification, and it only ever carries good news: an
"Antworten für dich" panel on the home screen that clears once she has looked.
The teacher gets a count on the inbox and a badge on his tab.

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
  It cannot judge pronunciation, vowel length or pitch accent, so nothing in the
  app claims it does. Results are framed as "verstanden als: …", she always taps
  the rating herself, and an explicit "Das war eigentlich richtig" is one tap
  away. `WHISPER_MODEL` defaults to `medium` because `small` makes too many
  mistakes on a beginner speaking a low-resource language; `small` remains
  available for constrained hosts.
- **Speech scoring thresholds are a judgement, not a measurement.** One wrong
  word in a four-word phrase reads as "close" rather than "good", because in
  Slovene the differing word is usually a case ending. Longer phrases stay
  forgiving. The thresholds live in one place (`src/lib/speech/scoring.ts`) and
  are meant to be tuned once there is real data.
- **Quick capture has no AI auto-fill yet.** The brief asks for a button that
  proposes the German translation and grammatical information from the Slovene.
  It arrives with the rest of the Anthropic integration in step 9 rather than
  shipping as a button that does nothing.
- **Neither speech service has been run end to end.** The scoring, storage and
  degradation paths are covered by tests against a stub recogniser, and the
  containers are written and wired, but no Slovene audio has been transcribed
  yet — this machine cannot run either container (see the Piper note above).
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
