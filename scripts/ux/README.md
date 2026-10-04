# The UX harness

Boots the app on a phone-sized Chromium, puts it into a named situation, walks
the journeys a person actually walks, and writes down what it saw.

It exists because the app has been reviewed a lot and *looked at* very little.
A reviewer who cannot open it — a nightly agent, or anyone reading a diff — can
check that the code is correct without ever noticing that the screen it renders
is hard to use. This turns the running app into something readable: PNGs, plus
a manifest of accessibility violations, console errors, failed requests and how
much of each screen fits above the fold.

```bash
pnpm ux:harness                     # every scenario, start to finish
pnpm ux:harness steady returning    # just these two
```

Output lands in `ux-report/<scenario>/`: numbered screenshots, a `README.md`
table, and `manifest.json` with the detail.

## Scenarios

An empty account answers no question worth asking. Every principle in
[the brief](../../slovene-app-prompt.md) is about a *situation*, so the harness
builds the situations:

| Scenario | State | What it is for |
| -------- | ----- | -------------- |
| `fresh` | Day one, nothing studied | The empty states, and whether starting is obvious |
| `steady` | A few weeks in, ~12 due | An ordinary day, comfortably under the review cap |
| `returning` | 24 days away, 300 cards overdue | Principle 3 — the backlog is capped and never dumped |
| `mid-session` | A review left half-finished | Principle 5 — sessions survive being closed on a phone |
| `teacher-busy` | Questions and drafts waiting | The teacher's half, with work actually in it |

`steady` and `returning` are a deliberate pair: one sits under the review cap
and one is far past it, so the capped presentation is recognisable as a
different screen rather than the only one ever seen.

Scenarios are built on the real curriculum (`pnpm seed:content`), not on
fixtures. Thirty-nine lessons in a list is a layout problem; one lesson is not.

## The pieces

- **`seed-scenario.ts`** — puts the database into one scenario. It refuses to
  run against a database containing any account it does not recognise, which is
  what makes it structurally incapable of rewriting the real deployment.
- **`stub-speech.mjs`** — stand-ins for Piper and Whisper. Without them the app
  correctly degrades: listening exercises disappear and speaking becomes
  self-assessment. That is right in production and wrong to audit, since
  speaking is the first skill the brief names.
- **`capture.ts`** — the walk itself.
- **`run-harness.sh`** — migrate, seed, build, boot, walk, repeat.
- **`verify.sh`** and **`axe-diff.mjs`** — before/after snapshots of a change,
  and the comparison between them. See below.

### What the stubs do and do not do

Piper's stand-in returns a WAV tone whatever format it was asked for. Chromium
sniffs the container rather than trusting the extension, so a `.opus` file
holding WAV bytes plays with a correct duration — checked, not assumed; a
hand-built Ogg/Opus loaded with a duration of `Infinity`, which would have put
a wrong number in the player and read as a bug that wasn't one.

Whisper's stand-in cannot recognise a tone, and the audio it receives says
nothing about what the learner was asked to say. So it returns whatever the
capture script last told it to return, over `POST /__control`. That is what
makes "good", "close" and "off" reachable on purpose rather than by luck, which
is the only way to photograph all three. The capture script learns the Slovene
target the way the learner does — it is revealed after the first attempt — and
then re-records against it.

## Reading the output

`README.md` in each scenario folder is the index. The columns worth scanning:

- **Fold** — `18% visible` means the screen is five times taller than the
  phone. Sometimes correct (a list of lessons), sometimes the finding.
- **axe** — WCAG 2.1 A/AA plus best-practice violations. Objective, and the
  part of "is this usable" a machine can settle on its own.
- **errors** — console errors and 4xx/5xx responses on that screen. Aborted
  prefetches are filtered out: Next cancels them constantly and reporting them
  would bury the real ones.

A state marked ⚠ is one the walk could not get past. That is a finding, not a
harness failure — the run records where it stopped and carries on.

## Checking a change

The tests can say whether a change broke the code. They cannot say whether the
screen it was meant to fix now looks right. `verify.sh` takes the same walk
before and after a change and compares the two:

```bash
pnpm ux:verify snapshot before steady    # before touching anything
# …make the change…
pnpm ux:verify snapshot after steady
pnpm ux:verify diff before after         # markdown, ready for a PR description
```

The diff lists every screen where an accessibility failure went away or
appeared, counted in failing elements — `26 → 0` means twenty-six things nobody
could read are now readable — plus any journey that stopped completing. What
did not move is folded away. Snapshots land in `ux-verify/<name>/`, screenshots
included, for the part a count cannot settle.

It brings its own database. With `DATABASE_URL` set (environment or `.env`) it
uses that; without, it starts a throwaway PGlite for the length of the snapshot
and deletes it afterwards. That is what lets the nightly agent run it in a job
that has no Postgres service. Each snapshot rebuilds the app, so expect a few
minutes apiece.

Two honest limits. The review and speaking screens show whichever card the
session dealt, so a change on those screens can be a different card rather
than a different app — the diff says so at the bottom. And everything is
captured in light mode only.

## Notes

- The harness never fails a build. It reports.
- `ux-report/` and `ux-verify/` are generated; neither is committed.
- `.env` fills in what the environment leaves unset; it never overrides it, the
  same rule `node --env-file` follows for the pnpm scripts.
- In CI it runs against a Postgres service container
  (`.github/workflows/ux-harness.yml`). Locally `pnpm dev:db` is enough — the
  run-harness script stops the app around each reseed, because PGlite serves
  one connection at a time.
- `UX_CHROMIUM_PATH` overrides the browser binary, for sandboxes that ship
  their own Chromium.
