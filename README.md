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
| 9 | AI generation with draft approval | done |
| 10 | Weekly digest | done |
| 11 | PWA and offline review | done |
| 12 | K8s manifests, backups, E2E suite | done |

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
pnpm cards:generate           # only needed if you seeded with --activate
pnpm dev
```

`SESSION_SECRET` needs at least 32 characters — `openssl rand -base64 48`. The
server refuses to start without it; CLI scripts that only touch the database
need `DATABASE_URL` alone.

Every command reads `.env` (`--env-file-if-exists`), so the file is the single
place configuration lives. Blank values in it mean "not set", which is what lets
a copied `.env.example` be a working configuration.

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
connection at a time, so set `DB_POOL_MAX=1` when the app points at it, and
stop the app before running a CLI script against the same database.

The full sequence on a machine with neither Docker nor Postgres:

```bash
cp .env.example .env
# DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
# DB_POOL_MAX=1
# SESSION_SECRET=$(openssl rand -base64 48)
# LEARNER_EMAIL / TEACHER_EMAIL (passwords are generated and printed)

pnpm dev:db                   # terminal 1, leave running
pnpm db:migrate               # terminal 2
pnpm seed:users
pnpm seed:content --activate  # ~6s; without --activate everything stays draft
pnpm cards:generate
pnpm dev                      # http://localhost:3000
```

No Piper and no Whisper in this mode: listening exercises disappear and
speaking falls back to self-assessment, which is the intended degradation.

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

### Kubernetes

```bash
cp k8s/secret.example.yaml k8s/secret.yaml   # fill in, gitignored
kubectl apply -f k8s/secret.yaml
kubectl apply -k k8s/

kubectl -n slovenscina exec deploy/app -- node scripts/seed-users.mjs
```

`k8s/` is plain YAML with a kustomization, no chart and no templating engine —
it is one small deployment and a Helm chart would be more machinery than the
thing it deploys. Postgres is a StatefulSet with its own PVC; media, backups
and the Whisper model each get a claim.

Every volume is `ReadWriteOnce`, so the app and Whisper use the `Recreate`
strategy: a rolling update would deadlock waiting for a volume the outgoing pod
still holds. The app runs one replica by design — it is two people, and session
state lives in Postgres, so there is nothing to gain from a second.

`ingress.yaml` is deliberately unopinionated: a host, a backend, and a body-size
annotation big enough for speech uploads. No controller, no cert-manager, no
issuer — the brief assumes an existing reverse proxy and certificate setup.

The weekly digest runs inside the app (`DIGEST_ENABLED=true`) rather than as a
CronJob. The job is idempotent per week and the scheduler is a 15-minute
interval, so a restart or a redeploy at the wrong moment resolves itself on the
next tick; a CronJob would need either `tsx` in the production image or an
authenticated trigger endpoint, and both are more surface than a loop that
already works.

`kubectl apply -k` is not the only supported path — every file applies
individually with `kubectl apply -f`. The kustomization exists mainly to mount
`scripts/ops/backup.sh` into the CronJob from the repo, so the script that runs
nightly is the same file you can read.

### Backups

`scripts/ops/backup.sh` dumps Postgres in custom format, verifies the dump is
readable with `pg_restore --list`, and prunes anything older than
`RETENTION_DAYS` (30 by default). It writes to a `.partial` and moves the file
into place only on success — a crash or a full disk must never leave a
truncated file that looks like a good backup.

Under compose or on a host:

```bash
DATABASE_URL=postgres://... BACKUP_DIR=/backups scripts/ops/backup.sh
```

In Kubernetes the `postgres-backup` CronJob runs it nightly at 02:30 into the
`backups` PVC.

**Restoring** drops and recreates the schema, so it refuses to run without an
explicit confirmation:

```bash
CONFIRM_RESTORE=yes DATABASE_URL=postgres://... \
  scripts/ops/restore.sh /backups/slovenscina-20260906T023000Z.dump
```

Stop the app first. On start it runs any migrations newer than the dump, so
restoring an older backup onto a newer build is fine. Check `/api/ready`
afterwards.

**Media is not in the database.** Generated audio, human recordings and every
speech attempt live on the media volume, and `pg_dump` does not touch them. The
recordings of family voices are the part that cannot be regenerated, so back
that volume up too — `restic`, `rsync`, or a volume snapshot, whatever the host
already does. Generated TTS can be rebuilt with `pnpm audio:generate`; a
recording of Oma cannot.

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

**Auto-fill** proposes the German, the register and a context note from the
Slovene alone. It only ever writes into empty fields — a suggestion that
silently replaced something he typed would be worse than no suggestion — and it
saves nothing: the entry is committed by pressing save, like any other.

## AI drafts

A teacher-side tool. Give it a topic ("beim Essen bei Oma"), how much, and
optional instructions, and Claude proposes phrases, words and cloze blanks.

**Everything lands as `status: draft` and is invisible to the learner.** Drafts
have no cards, and the only code path that creates one is approval. This is the
rule the feature exists around, so it is asserted from several directions in
`tests/integration/generation.test.ts`, including a test whose entire body
checks that a fresh batch has given her nothing to study.

The pipeline is: forced tool call for structured output → Zod → database. There
is no prose parsing anywhere and no field-by-field repair: if the answer does
not match the schema the whole run is marked failed with the reason on it and
nothing is inserted. A cloze whose blanked word is not actually a token in its
phrase loses the blank and keeps the phrase, because guessing which word was
meant is how a wrong case ending gets drilled for six weeks.

The review screen edits every field in place, since correcting and approving is
one action rather than two — the alternative is approving something slightly
wrong and fixing it after she has already seen it. Approving activates the item,
creates her cards and generates its audio; rejecting archives the draft and
leaves the run as a record of what was thrown out. Batch approve and reject act
on one run at a time.

Duplicates are **warned about, never silently skipped**. A proposal that
collides with an existing item is shown next to what it hit, and approving it
fills in what the existing entry is missing instead of adding a second copy —
the existing text always wins, because it is usually something he wrote down at
a family table himself.

Each run keeps its own audit trail: the prompt, the model, token usage, the
model's own caveats, and the payload of every proposal next to the row it
became. When something subtly wrong surfaces weeks later, "did the model write
that or did I?" has an answer.

Without `ANTHROPIC_API_KEY` the generate screen and the auto-fill button are
simply absent. Nothing else changes.

## Offline

She will use this on a phone, and phones lose signal. A review session works
with no connection at all: the cards, their answers and their audio are already
on the device, and what she answers is queued and sent back when the signal
returns.

**The bundle.** While she is online and idle, the app fetches the next session
in one response and stores it in IndexedDB, with the audio going into the Cache
API. The home screen says so in one quiet line — the point is that "will this
work on the train" is answered *before* she is on the train.

That bundle carries the answers, which the online path deliberately never sends
ahead of time. Offline there is nobody to ask later, so the trade is
unavoidable; it is confined to that one route, and it is her own deck on her
own phone. Typed answers are then graded by the same pure comparison the server
runs, so `zivjo` without the diacritics is still counted right in a tunnel.

**The queue.** Every answer is stored with a **client-minted id**, and the
server rejects an id it has already seen. This is the part that had to be right:
a lost answer is an annoyance, but a double-applied one moves her schedule
silently and permanently. Recordings are queued the same way as blobs, uploaded
one at a time on reconnect, and transcribed then — she judges her own speaking
either way, so a deferred transcript changes nothing about the card.

Replay uses **her timestamps, oldest first**. FSRS schedules from the moment of
the answer, so applying a Tuesday answer as though it happened on Thursday
would corrupt the interval. An event that cannot be applied — usually a card
that no longer exists — is dropped rather than retried forever, because one bad
event must not block every answer behind it.

**The service worker** is hand-written and small: network-first for pages with
an offline fallback, cache-first for audio, cached build assets, and it never
touches `/api/offline/*` or anything under `/teacher`. Pages are personal and
server-rendered, so a cached page would be a lie about her deck. Lessons and
the teacher area need a connection, by design.

**Installable** with a manifest, maskable icons and shortcuts straight to a
review session or to quick capture. The icon is **Č** — the caron is what makes
Slovene look like Slovene, and the app treats those three letters as a
first-class concern. `pnpm icons:build` rasterises the PNGs from geometry with
no image library; the output is committed and changes about once a year.

## The weekly digest

One person reads it, and its only job is to tell him what to record or explain
next. It reports the week and never characterises it: no streak, no target, no
"only two sessions" — **the digest must not become a nag he is expected to
relay.** If she did not study, it says when she last did and moves on.

Per week: reviews, distinct cards, days with any practice, retention, newly
started cards, lessons finished, and how much she can say in total. Then the
part that is actually the point — the ten items that are not sticking, ranked
by lapses and then by how little has stuck, **grouped by item rather than by
card** so one hard phrase does not fill the list three times over as its
recognition, listening and speaking cards.

That list is actionable in place: record a voice for the item, or write the
context note that says when it is used, both without leaving the page. A list
that could only be read would report that something is hard and leave him to go
find it, which is the version of this feature nobody uses.

Retention counts only reviews of cards that were already in the review state —
learning-step repeats would flatter the number, and a flattering number is
useless for deciding what to teach next. A week with no mature reviews has no
rate at all rather than a zero, because a zero reads as a failure.

**Scheduling** is a weekday, hour and timezone (`DIGEST_DAY`, `DIGEST_HOUR`,
`DIGEST_TIMEZONE`), and lands at a real local time: 18:00 stays 18:00 across
both clock changes. The job is idempotent per week, which is what lets the
scheduler be a plain interval rather than a cron with state — it checks every
15 minutes, writes the week if it is not there, and does nothing otherwise.
`DIGEST_ENABLED=false` turns it off in favour of `pnpm digest:run` from cron or
a Kubernetes CronJob.

**Email is optional and off by default.** Without `SMTP_URL` and
`DIGEST_EMAIL_TO` the digest simply waits in the teacher area. Only a newly
written week is ever mailed, so re-running the job — or rebuilding a week from
current data — cannot send the same digest twice.

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
- **The E2E suite has never been run.** Sixteen specs across the six journeys
  the brief names are written and parse, but Playwright refuses to install a
  browser on this machine (`Playwright does not support chromium on mac13`),
  so not one of them has executed. They are the least-proven code in the
  repository and should be treated as a first draft until they have run green
  somewhere with a browser.
- **Nothing has been deployed.** No Docker image has been built, no compose
  stack has come up, and the Kubernetes manifests have never met a cluster —
  there is no Docker and no kubectl here. The manifests are checked by
  `tests/unit/k8s-manifests.test.ts` for the mistakes that are cheap to make
  and expensive to find in a cluster (undefined Secret keys, unclaimed volumes,
  probes on closed ports, rolling updates on RWO volumes), and that test was
  itself verified by breaking each of those things on purpose. That is not the
  same as a cluster accepting them.
- **The backup scripts have not been run against a real database.** There is no
  `pg_dump` here. Their guards — missing variables, absent dump file, the
  refusal to restore without `CONFIRM_RESTORE=yes`, password redaction in
  output — have been exercised; the dump and restore paths have not.
- **Offline mode has not been exercised in a real browser.** The sync
  contract — idempotency, ordering, timestamps, rejection — is covered by
  integration tests and was driven end to end against the running server, but
  no service worker has actually installed, no IndexedDB write has happened
  outside a type checker, and no phone has gone into a tunnel. That is the next
  thing to test on a real device.
- **No SMTP server has been talked to.** The digest email is rendered, escaped
  and covered by tests, and the send path is behind an interface that the tests
  drive with a stub, but nothing has been handed to a real mail server. The
  digest itself does not depend on it.
- **The Anthropic API has never actually been called from here.** There is no
  key on this machine, so generation and auto-fill have only ever run against a
  stub client: the schema, dedup, draft, approval and failure paths are covered
  by tests, and the screens have been rendered, but the first real call will be
  the first real call. The request shape follows the Messages API tool-use
  contract (`tool_choice` forced to the one tool), which is the part most likely
  to need a correction.
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

## Testing

```bash
pnpm test              # unit: scheduling, scoring, backlog, config, manifests
pnpm test:integration  # against PGlite over its real wire protocol
pnpm test:e2e          # Playwright, needs a browser and real PostgreSQL
```

The unit suite covers what the brief singles out as the places a bug would
silently corrupt her learning: FSRS scheduling, the answer comparison, and the
backlog cap. It also checks the deployment manifests and the environment
parsing, both of which are cheap to get wrong in ways that only show up in
production.

Integration tests run against PGlite served over the PostgreSQL wire protocol,
so the app's own driver and SQL are exercised rather than a stand-in. Piper,
Whisper and the Anthropic API are stubbed behind their interfaces.

The E2E suite needs real PostgreSQL — PGlite serves one connection at a time,
and a browser plus a server is already more than that. See
[`tests/e2e/README.md`](./tests/e2e/README.md). `pnpm e2e:seed` creates the two
accounts and a small deck, and refuses to run against a database that has more
content than a seeded one.

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
