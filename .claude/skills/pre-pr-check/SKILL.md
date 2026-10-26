---
name: pre-pr-check
description: Final gate before committing or opening a PR in this repo — run the checks, review the diff against the app's product rules, confirm docs and tests moved with the code, and write the PR description in the house format. Use when a change is "done", before `gh pr create`, or when asked to review a branch.
---

# Before the PR

## 1. Gates

```bash
pnpm check                # typecheck + lint + unit tests
pnpm test:integration     # if anything under src/lib, src/db or drizzle/ changed
pnpm db:generate          # must print "No schema changes" — or commit what it wrote
pnpm build                # if routing, config, next.config.ts or fonts changed
```

Lint warnings from the React Compiler rules are pre-existing; your diff must
not add new ones (`pnpm lint 2>&1 | grep -c warning` before and after).

If a gate fails and you cannot fix it, stop and report the output. Don't
weaken a test, add a lint disable, or acknowledge a destructive migration to
get green.

## 2. Read your own diff against the product rules

`git diff main...HEAD`, then answer each — a "yes" needs fixing or an
explicit, argued exception in the PR:

- [ ] Does a learner screen show a streak, a goal, a count of missed days, or
      any due number not passed through `displayDueCount()`?
- [ ] Does any learner copy scold, pressure, or cheer with exclamation marks?
- [ ] Can AI-generated content reach her deck or get cards without approval?
- [ ] Does a generated voice now win over a human recording anywhere, or does
      an answer voice note play as item audio?
- [ ] Does anything throw or error when Piper / Whisper / Anthropic / SMTP is
      not configured?
- [ ] Does the speech result now *judge* pronunciation, or rate for her?
- [ ] Can quitting mid-card lose an answer, or can an offline answer be
      applied twice or with the wrong timestamp?
- [ ] Is there a server action or page without `requireUser()` /
      `requireTeacher()`? A teacher route reachable by the learner?
- [ ] Any hardcoded user-facing string, raw colour, or Slovene text without
      `className="slovene"`?
- [ ] A migration that drops, renames, retypes, or adds NOT NULL without a default?
- [ ] `process.env` read outside `src/lib/env.ts`, or `console.log` in `src/`?
- [ ] New `/teacher` or `/api/offline` path the service worker might cache?

## 3. Things that move together

- [ ] Behaviour changed → the matching `README.md` section updated.
- [ ] Something could not be run (browser, container, real API) → stated in
      `README.md` → "Known limitations" if lasting, and in the PR regardless.
- [ ] New env var → `src/lib/env.ts` schema, `.env.example` with a comment,
      and `k8s/` config/secret if deployed.
- [ ] New strings → both `messages/*.json`.
- [ ] New behaviour → a test that would fail without it; product-rule-adjacent
      behaviour → a test asserting the rule.
- [ ] Visible change → `ux-verify` before/after.
- [ ] Curriculum counts changed → `seed/README.md`.

## 4. Commit and PR

Commit subject: one imperative sentence about the outcome, as in the history
("Point the home screen at new lessons when nothing is due"). Body: what was
wrong, why this fix, what was deliberately left alone. No file lists.

Branch from `main` (`feat/…`, `fix/…`, `chore/…`). Push and open the PR only
when asked. The PR body follows `.github/pull_request_template.md`:

- `Closes #N` first line when there is an issue.
- Summary in prose — the same voice as the commits.
- `### Visual verification` with the `ux-verify` diff for UI changes.
- `### Not verified` — anything you could not run, said plainly.
- The product-rule checklist from the template, ticked honestly.
