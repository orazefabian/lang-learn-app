---
name: ux-verify
description: Photograph a UI change before and after with the repo's UX harness and produce the accessibility diff for the PR description. Use for any change that alters what a screen looks like or how it behaves — layout, copy, buttons, empty states, contrast, headings — and when an issue was filed by the UX audit.
---

# Before/after visual verification

Tests say whether the code broke. They can't say whether the screen now looks
right. `scripts/ux/` boots the app on a phone-sized Chromium in a named
situation, walks it, and records screenshots, axe (WCAG 2.1 A/AA) violations,
console/network errors and how much fits above the fold. Full docs:
`scripts/ux/README.md`.

## Pick the scenario

| Scenario | Use when the change touches |
| -------- | --------------------------- |
| `fresh` | empty states, first run, home with nothing studied, lessons list |
| `steady` | an ordinary day: home, review, speaking, progress |
| `returning` | anything about the backlog or due counts (rule 2 — the cap) |
| `mid-session` | resuming a session, review state |
| `teacher-busy` | teacher hub, inbox, drafts, digest |

Pass several if the change spans them: `… snapshot before steady returning`.

## Steps

The **before** snapshot must be of the code *without* your change.

```bash
# 1. Before — on the base commit
git stash            # if you already have changes; or snapshot first
pnpm ux:verify snapshot before steady
git stash pop

# 2. After — with the change
pnpm ux:verify snapshot after steady

# 3. Diff — markdown for the PR
pnpm ux:verify diff before after
```

Each snapshot does a production build, so expect a few minutes each.

Prerequisites: a Chromium (`pnpm exec playwright install chromium`, or
`UX_CHROMIUM_PATH=/path/to/chromium`). No database needed — without
`DATABASE_URL` it starts a throwaway PGlite. If `.env` points at a database
with real accounts, the scenario seeder refuses to touch it; that is the guard
working. Use a throwaway `DATABASE_URL` instead, never weaken the guard.

## Then look at the pictures

The numbers settle what a machine can. **Open the PNGs** for the screens you
changed — `ux-verify/after/<scenario>/NN-<screen>.png` — and compare them with
`before/`. Check what the change was for (the button, the spacing, the copy)
and that nothing next to it moved. Check the fold: a key action pushed below
it is a regression even with zero axe changes.

## Write it up

In the PR description, under `### Visual verification`:

1. The diff output, verbatim.
2. One or two sentences naming the screenshot(s) that show the change and what
   is different in them ("In `fresh/04-home.png` before, 'Wiederholen' was the
   one filled button. After, …").
3. Any unchanged failure you noticed that is *not* yours — reference its issue
   number rather than fixing it in passing.

## Honest limits — say them when they apply

- Review and speaking screens show whichever card the session dealt; a
  difference there can be a different card, not a different app.
- Light mode only. If the change touches colour, check dark-mode tokens in
  `src/app/globals.css` by reading them, and say you did.
- Piper and Whisper are stubs (a tone, and a scripted transcript).
- **If you could not run the harness** (no browser, no network, sandbox), say
  exactly that in the PR. Do not describe screenshots you did not take.
