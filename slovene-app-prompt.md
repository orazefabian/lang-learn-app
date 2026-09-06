# Build: "Slovenščina" — a self-hosted Slovene learning app for two people

## Context

I am building a Slovene language learning app for my girlfriend, because no major
platform (Duolingo, Babbel, Busuu, Memrise) offers Slovene. This is a personal,
self-hosted app with exactly **two users**: her (the learner) and me (the teacher).

**The learner:** German native speaker, absolute beginner in Slovene, no prior
exposure. Her goal is to be able to talk with my Slovene-speaking family and
friends. Not exam prep, not certification — real conversation with real people
she knows.

**Study pattern:** unpredictable. Some days 5 minutes, some weeks nothing, then a
long session. The app must be designed around this reality, not fight it.

**Skill priority, in order:** speaking/pronunciation > listening comprehension >
reading/vocabulary > grammar correctness. Grammar matters, but it should be
absorbed through use, not drilled as tables.

Build the full feature set described below. Ask me the clarifying questions at
the end of this document before you start writing code.

---

## Design principles (these override convenience)

1. **No streaks, no guilt, no punishment mechanics.** No "you lost your streak",
   no daily goal shaming, no lives/hearts. Coming back after two weeks must feel
   welcoming, not like a debt collection notice. Progress is shown as what she
   *can now say*, not as consecutive-day counters.
2. **Speaking first.** Every unit of content is something she could actually say
   out loud to a person. Prefer full phrases over isolated nouns.
3. **Backlog is capped, never dumped.** If she has been away and 400 cards are
   due, never show "400 due". Show a manageable session and let FSRS catch up
   over days. See the SRS section.
4. **Real people over generic content.** Content tied to my actual family and
   real situations beats textbook dialogues.
5. **Sessions are resumable and interruptible.** She may quit mid-session on a
   phone. Nothing is ever lost.
6. **Portable deployment.** Must run identically on a k3s cluster or a single VPS
   with Docker Compose. No managed-cloud lock-in.

---

## Users and roles

Two accounts only. No public signup.

- **Learner** (her): does lessons and reviews, asks questions, records audio.
- **Teacher** (me): everything the learner has, plus a role-switched teacher area.

Same app, same URL. Role switching in the UI, gated by the account's role. I want
to be able to sit next to her and switch views on my own phone.

**Auth:** simple and self-contained. Email + password with Argon2id hashing,
signed HTTP-only session cookies, no third-party identity provider. Two accounts
seeded via a CLI script (`pnpm seed:users`). Add optional WebAuthn/passkey later
— design the auth tables so it can be added, but do not build it now.

---

## Tech stack

- **Next.js (App Router, latest stable) + TypeScript**, React Server Components
  where sensible. `output: "standalone"` for slim Docker images.
- **PostgreSQL** as the only datastore.
- **Drizzle ORM** with checked-in SQL migrations.
- **Tailwind CSS** + shadcn/ui for components.
- **ts-fsrs** for the spaced-repetition scheduler (FSRS-5). Do not implement SM-2.
- **PWA**: installable, offline-capable for review sessions (see Offline).
- **Piper** (self-hosted, containerized) for Slovene TTS.
- **faster-whisper** (self-hosted, containerized) for Slovene ASR.
- **Anthropic API** (Claude) for content generation, called server-side only.
- **Vitest** for unit tests, **Playwright** for a small critical-path E2E suite.

Everything containerized. Provide both a `docker-compose.yml` and Kubernetes
manifests (plain YAML or a small Helm chart) that share the same images. Config
strictly via environment variables, documented in `.env.example`.

**UI language:** German. Set up i18n (next-intl or similar) with `de` as default
and `en` as fallback, all copy in message files — no hardcoded strings. Code,
comments, and identifiers in English.

---

## Domain model

Design the schema properly; this is the core of the app.

### Content entities

- **Lexeme** — a Slovene word or fixed phrase. Fields: Slovene form, German
  translation(s), part of speech, gender (m/f/n) for nouns, aspect
  (perfective/imperfective) for verbs, notes, difficulty estimate, tags,
  `source` (seed | ai | teacher), `created_by`, `status` (draft | active |
  archived).
- **Phrase/Sentence** — a full utterance with German translation, optionally
  linked to the lexemes it contains, plus a `context_note` (when/where you'd
  say this, who says it).
- **Lesson** — an ordered, themed introduction unit. Contains a short teaching
  segment (new material with explanation in German) and the items it introduces.
- **Unit/Track** — ordered grouping of lessons.
- **MediaAsset** — audio file, with `kind` (tts | human_recording), speaker
  label, and a link to the lexeme/phrase it voices. Multiple assets per item are
  allowed and expected.

### Learning entities

- **Card** — a specific (item, exercise_type) pair. One lexeme/phrase produces
  several cards (recognition, production, listening, speaking). Cards are what
  FSRS schedules, not items.
- **ReviewLog** — every grading event: card, timestamp, rating, elapsed time,
  scheduler state before/after. Never delete; this is the data for the digest.
- **SpeechAttempt** — audio blob reference, ASR transcript, similarity score,
  the card, timestamp.
- **Session** — a study session with start/end, resumable state.

### Interaction entities

- **Question** — the learner's "I don't get this" on a card: card reference, her
  text, status (open | answered), my answer (text and/or audio), answered_at.
- **DigestSnapshot** — weekly aggregated stats, generated by a scheduled job.

---

## SRS engine

Use **ts-fsrs** with default FSRS-5 parameters. Store full scheduler state per
card. Add a job that recomputes optimal parameters from her ReviewLog once there
are enough reviews (≥1000), and log the result rather than applying it silently.

**Ratings:** four buttons (Again / Hard / Good / Easy) for recognition-type
cards. For speaking and listening cards, derive the rating automatically from the
scoring (see Speech evaluation) but always let her override.

**Backlog handling — important:**

- Cap each session's review queue at a configurable size (default 20 cards) plus
  new material.
- When overdue cards exceed the cap, prioritize by: most overdue relative to
  interval, then lowest stability, then oldest.
- Never display a raw "cards due" count above the cap. Show "Heute dran" with
  the capped number.
- Apply FSRS's handling of long delays correctly — a card reviewed 40 days late
  and answered correctly should get credit for that, not be reset.

**Daily new-material limit:** configurable (default 8 new items/day), and never
introduce new material when the overdue backlog exceeds a threshold — clear the
debt first, silently.

---

## Course structure (hybrid)

Lessons introduce, SRS reviews. Concretely:

- A **lesson** is a short (3–6 min) guided sequence: presentation of new items
  with German explanation, audio for every item, immediate low-stakes practice.
- Completing a lesson creates the cards for its items and hands them to FSRS.
- **Reviews are independent of lessons.** She can review without doing a lesson
  and vice versa. The home screen offers both: "Weiter lernen" (next lesson) and
  "Wiederholen" (due reviews), with the review path always available.
- Lessons are ordered but **not hard-gated** — she may skip ahead with a warning.

**Initial curriculum** — design roughly 30–40 lessons across these themes,
sequenced for the goal of talking to family:

1. Greetings, introductions, "how are you", politeness formulas
2. Family members and relationships
3. Basic personal info: name, origin, where you live, languages
4. Numbers, time, days
5. Food, drink, at the table (critical — family meals)
6. Likes/dislikes, opinions, agreeing and disagreeing
7. Small talk: weather, weekend, work
8. Getting around, shops, ordering
9. Feelings and simple states
10. Past events, simple storytelling ("what did you do")

Write the actual content for these lessons as seed data. It does not have to be
perfect — I will review and edit it in the teacher UI.

---

## Exercise types

Each generates its own card type:

1. **Listening → meaning.** Hears Slovene audio, picks/types the German meaning.
   No text shown initially; text revealed after answering.
2. **Speaking.** Sees German prompt (or hears a Slovene model), records herself
   saying it in Slovene, gets scored. See Speech evaluation.
3. **Production (typing).** German → types the Slovene. Accept minor typos;
   handle Slovene diacritics (č, š, ž) leniently — accept `c/s/z` substitutes but
   show the correct form.
4. **Recognition.** Slovene → German, multiple choice or reveal.
5. **Cloze.** A sentence with one word blanked, chosen to exercise a case ending
   or verb form. This is how grammar gets practiced — in context, never as tables.
6. **Listening dictation** (later-stage cards only): types what she hears.

Speaking and listening cards should be weighted more heavily in the mix, per her
priorities. Make the mix configurable.

---

## Audio pipeline

**Default: Piper TTS.** Run Piper as a container behind a small internal HTTP API.
Use a Slovene voice model — verify which `sl_SI` voices Piper currently ships and
pick the best available; make the voice configurable by env var. If no acceptable
Slovene Piper voice exists, fall back to an alternative self-hostable engine and
document the choice clearly in the README rather than silently degrading.

- Generate audio **at content-creation time**, not at request time. Cache as
  files on a volume, keyed by content hash. Regenerate on content edit.
- Store audio as Opus/WebM for size, with an mp3 fallback for compatibility.

**Human recordings override TTS.** Any item may have one or more human recordings
attached. When present, prefer a human recording in exercises, and let her hear
alternates. Recordings carry a speaker label ("Papa", "Oma", "ich") — hearing the
actual voices of the people she'll talk to is a core feature, not a nice-to-have.

Teacher UI must allow recording audio directly in the browser (MediaRecorder) and
attaching it to any item, plus uploading files.

---

## Speech evaluation

Run **faster-whisper** as a container behind an internal HTTP API, forced to
`language="sl"`.

Flow: she records → audio uploaded → transcribed → compared to the target.

**Scoring:** normalized comparison (lowercase, strip punctuation, optionally
fold diacritics) using a character-level similarity (Levenshtein ratio) plus a
word-level check. Map to three bands: good / close / off. Show her the
transcript next to the target with a visual diff so she can see *what* differed.

**Be honest about the limits.** Whisper on Slovene is decent at word recognition
but cannot judge fine pronunciation, vowel length, or pitch accent. Therefore:

- Never present the score as authoritative pronunciation feedback. Frame it as
  "verstanden als: …" (understood as: …).
- Always allow her to override the automatic rating ("Das war eigentlich richtig").
- Every attempt is stored, so I can listen to them later.
- Keep the ASR service behind an interface so a better Slovene model can be
  swapped in without touching the app.

Run ASR server-side. Audio uploads are stored on a volume, with a retention
setting (default: keep everything; it is two users).

---

## Content pipeline

Three sources, all landing in the same review pipeline:

1. **Seed deck.** Build a starter corpus of ~800–1200 high-frequency Slovene
   words plus the lesson phrases, German glosses included, shipped as versioned
   seed files (JSON or CSV) in the repo. Source from openly licensed frequency
   data where possible; document the source. Do not scrape anything requiring a
   license.
2. **AI generation (Anthropic API).** A teacher-side tool: I give a topic,
   situation, or difficulty level, and Claude generates candidate lexemes,
   phrases with context notes, and cloze sentences with correct case forms.
   - Server-side only; API key from env.
   - Output must be **structured JSON**, validated with Zod before it touches
     the database.
   - Generated content lands in `status: draft` and **never enters her deck
     until I approve it** in a review screen. This is non-negotiable — Slovene
     grammar is easy to get subtly wrong and I don't want errors drilled in.
   - Batch approve/edit/reject UI, with inline editing of every field.
3. **My manual additions.** See Teacher features.

Deduplicate against existing lexemes on insert (normalized form match) and warn
rather than silently skipping.

---

## Teacher features

Role-switched area inside the same app. Build all three of these:

### 1. Quick-capture with context notes

The signature feature. I hear a phrase at a family dinner and need to capture it
in under 10 seconds, on my phone, possibly one-handed.

- A prominent quick-add entry point (also a PWA shortcut / share target).
- Minimum required input: the Slovene phrase. Everything else optional.
- Fields: Slovene, German, **context note** (free text: "was Oma sagt, wenn sie
  dir Essen anbietet"), tags, optional immediate voice recording.
- Auto-fill assist: a button that asks Claude to propose the German translation,
  part of speech, and grammatical info from the Slovene input — as suggestions I
  can accept or edit, never auto-committed.
- Saved items go into the **normal SRS pool with no priority boost**. They are
  not urgent, they are just part of what she's learning. Do not build a
  "priority injection" or deadline mechanic.
- The context note is shown to her on the card. This is the thing that makes it
  memorable — she learns the phrase *and* the human situation it belongs to.

### 2. "Ask me" button → my inbox

- On every card in her session, an unobtrusive "Verstehe ich nicht" button.
- Tapping it captures the card, her optional free-text question, and files it in
  my teacher inbox. Non-blocking: her session continues immediately.
- I answer with text and/or a recorded voice note.
- **The answer attaches permanently to that item** and is shown to her on that
  card from then on, and surfaces in her notifications when answered.
- Inbox shows open/answered counts; badge in the teacher view.

### 3. Weekly digest to me

- Scheduled job (weekly, configurable day/time) producing a digest, viewable
  in-app and optionally emailed via SMTP (env-configured, off by default).
- Content: items reviewed, retention rate, new items learned, **the 10 items she
  struggles with most** (lowest FSRS stability / most lapses), speaking attempts
  with lowest scores, open questions I haven't answered, and time since last
  session — reported neutrally, never as a nag I'm supposed to relay.
- The point is so I can steer what I add next. Make the struggling-items list
  actionable: one tap from the digest to record a human pronunciation or add a
  clarifying note.

Also give the teacher area: a content browser with search/edit/archive over all
lexemes and phrases, and the AI draft-approval screen.

**Do not build:** priority injection, deadlines/missions, event packs,
co-learner mode. I considered them and cut them for v1.

---

## Slovene-specific requirements

Do not treat Slovene as a generic language. It has features that generic
platforms handle badly, and handling them well is the reason this app exists.

- **Dual number.** Slovene has singular, dual, and plural. This is genuinely
  unusual and must be taught explicitly and early-ish, with its own lessons and
  cloze practice. The data model must represent dual forms.
- **Six cases** (nominative, genitive, dative, accusative, locative,
  instrumental). Store case forms where known. Teach them through cloze in
  context, sequenced by usefulness for conversation (nominative → accusative →
  locative → genitive → dative → instrumental), not by traditional table order.
- **Gender** on nouns, affecting adjective and past-tense verb agreement.
- **Verb aspect** (perfective/imperfective pairs) — store as a pair relationship.
- **Diacritics** č, š, ž: input must be easy on a German phone keyboard. Accept
  unaccented input as correct but always display and speak the correct form.
- **Pitch accent / vowel length:** do not attempt to teach or grade this. Provide
  good audio and let her imitate. Note this limitation in the README.
- **Colloquial vs. standard.** My family speaks real, everyday Slovene, likely
  with regional colouring. Where a phrase is colloquial or regional, allow it to
  be flagged as such and shown with that label, rather than forcing textbook
  standard forms.

Provide a grammar-notes system: short, plain-German explanations attachable to
items and lessons, always available on demand but never blocking practice.

---

## UX requirements

- **Phone-first.** She will use this on a phone almost exclusively. Thumb-reachable
  controls, large tap targets, one-handed operation for the whole review flow.
- **Installable PWA**, proper manifest, icons, splash, standalone display.
- **Home screen** shows: what's due today (capped number), continue-lesson entry,
  any answered questions, and a "what I can say now" progress view — a growing
  list of phrases she has mastered, framed as capability, not points.
- **Session flow:** minimal chrome, one card at a time, immediate feedback,
  keyboard-friendly on desktop, swipe-friendly on mobile.
- **Resumable:** session state persisted server-side; closing the app mid-session
  loses nothing.
- **Audio autoplay** on listening cards where the browser allows it, with an
  obvious replay control and a slow-playback (0.75×) button.
- **Dark mode**, respecting system preference.
- **Accessibility:** proper labels, focus management, sensible contrast. Do not
  rely on colour alone for correct/incorrect.

### Offline

Service worker caching so that **a review session works offline**: pre-cache due
cards and their audio for the next session, queue review results and speech
recordings locally (IndexedDB), sync on reconnect. Lessons and teacher features
may require connectivity. Speech scoring may be deferred until reconnect — record
offline, score on sync.

---

## Deployment

- Multi-stage Dockerfiles for the Next.js app; separate images/services for
  Piper and faster-whisper.
- `docker-compose.yml` bringing up app + Postgres + Piper + Whisper + a volume
  for media, working end-to-end on a single host.
- Kubernetes manifests for the same, with PVCs for media and Postgres,
  Ingress-ready, resource requests/limits set sensibly. Assume it may sit behind
  an existing reverse proxy / cert manager — do not bundle one.
- Health/readiness endpoints for every service.
- Automated Postgres backup script (pg_dump to a volume, retention) plus a
  documented restore procedure. Media volume backup guidance in the README.
- Migrations run automatically on startup, idempotently.
- Whisper and Piper are CPU-heavy: document expected resource needs, make model
  size configurable (whisper `small` default, `medium` optional), and make both
  services optional-at-runtime — if Whisper is unavailable, speaking exercises
  degrade to self-assessment rather than crashing.

---

## Quality bar

- TypeScript strict mode, no `any` escapes in domain code.
- Zod validation at every boundary: API input, AI output, seed import.
- Unit tests for the SRS scheduling logic, the answer-comparison/scoring logic,
  and the backlog-capping algorithm. These three are where bugs would silently
  corrupt her learning.
- Playwright E2E for: login, complete a lesson, do a review session, record a
  speaking answer, teacher quick-add, ask-a-question round trip.
- Structured logging, an error boundary that doesn't lose session progress.
- README covering setup, env vars, seeding, deployment on both targets, backups,
  and the known limitations (Whisper's Slovene accuracy, no pitch-accent
  grading, TTS voice quality).

---

## Build order

Work in this order and keep the app runnable at each step:

1. Project scaffold, Docker/compose, Postgres, schema, migrations, auth + seeded
   users, i18n skeleton.
2. Content model + seed import (frequency deck + lesson content).
3. FSRS integration, card generation, review session flow with recognition and
   production exercises. Tests for scheduling and backlog capping.
4. Piper integration, audio generation pipeline, listening exercises.
5. Whisper integration, speaking exercises, scoring with diff display and manual
   override.
6. Lessons and curriculum, home screen, progress view.
7. Teacher area: content browser, quick-capture, human recording upload.
8. Ask-me questions inbox and round trip.
9. AI generation with draft approval workflow.
10. Weekly digest job.
11. PWA, offline review, service worker sync.
12. K8s manifests, backups, README, E2E suite.

---

## Before you start

Ask me about anything genuinely ambiguous, but especially:

1. Which Slovene Piper voice you found and whether its quality is acceptable, or
   what you propose instead.
2. Which openly licensed Slovene frequency list / corpus you intend to use for
   the seed deck.
3. Any schema decisions where you see a fork worth my input (especially how you
   model case/dual forms — I care about getting that right).
4. Anything in this spec that you think is a mistake. If you disagree with a
   design decision here, say so before building it.

Then propose a concrete plan and start at step 1.
