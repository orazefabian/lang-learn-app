---
name: curriculum-content
description: Add or edit course content — units, lessons, phrases, lexemes, cloze blanks and grammar notes in seed/curriculum/*.json — so it validates, imports idempotently and fits the course's pedagogy. Use when asked to add lessons or vocabulary, fix a translation, add a grammar note, or extend a topic.
---

# Curriculum content

The course is 10 units / 39 lessons of hand-written JSON in
`seed/curriculum/NN-<unit-slug>.json`, validated by `curriculumFileSchema` in
`src/lib/seed/schemas.ts` and imported by `pnpm seed:content`. It is sequenced
for one purpose: talking to the teacher's Slovene family. Content is judged by
"could she say this to Oma at the table?", not by textbook coverage.

**Language accuracy is the part you can get wrong silently.** You are writing
Slovene for a beginner who will drill it for weeks. If you are not certain of a
form (case ending, dual, aspect, colloquial vs. standard), say so in the PR and
mark the item `notes` with what to check — don't guess confidently. The teacher
is a speaker; flag, don't invent.

## File shape

```jsonc
{
  "unit": { "slug": "familie", "titleDe": "Familie", "descriptionDe": "…", "position": 2 },
  "grammarNotes": [
    { "slug": "dvojina-grundlagen", "titleDe": "…", "bodyDe": "Markdown, German, *slovene in italics*", "tags": ["dvojina"] }
  ],
  "lessons": [
    {
      "slug": "wer-ist-wer", "titleDe": "Wer ist wer", "goalDe": "Du kennst …",
      "position": 1, "estimatedMinutes": 5, "grammarNoteSlugs": ["dvojina-grundlagen"],
      "items": [
        { "kind": "phrase", "slovene": "To je moja mama.", "german": "Das ist meine Mama.",
          "contextNote": "Beim Vorstellen.", "register": "standard", "difficulty": 1,
          "cloze": [{ "position": 2, "answer": "moja", "hintDe": "mein (weiblich)" }] },
        { "kind": "lexeme", "slovene": "ata", "german": ["der Papa"], "partOfSpeech": "noun",
          "gender": "m", "register": "colloquial", "notes": "Formeller: oče.", "difficulty": 1 }
      ]
    }
  ]
}
```

- Lesson `position` is **per unit** (1, 2, 3 …); unit `position` orders units.
- Slugs: lowercase ASCII and hyphens, unique across *all* files.
- Phrase `german` is a string; lexeme `german` is an array of glosses with the
  article (`"die Mama"`).
- `cloze.position` is a **zero-based whitespace token index** — punctuation
  stays attached to the token and is ignored when matching (`tokenizePhrase`,
  `stripPunctuation`). `"To je moja mama."` → `moja` is position 2.
- `register`: `standard | colloquial | regional | formal`. Real family speech
  is labelled, not corrected — use `colloquial`/`regional` + `regionLabel`.
- Optional cloze focus: `focusCase`, `focusNumber` (`dual`!), `focusVerbForm`.

## Pedagogy rules (tests enforce some)

- **Phrases over isolated nouns.** Every lesson should have things she can say
  out loud to a person. Lexemes support phrases; they don't replace them.
- **Cases in conversational order**: nominative → accusative → locative →
  genitive → dative → instrumental. The first accusative cloze must come no
  later than the first genitive one (tested).
- **The dual is first-class.** Tag every item that turns on it with
  `"dvojina"` — that tag is what gives it the dual mark on the progress page
  (`src/lib/progress/service.ts`) — and use a `focusNumber: "dual"` cloze
  where drilling the form helps.
- **Grammar is on demand.** Notes are short, plain German, example-led, and
  never block practice. A lesson only references notes that exist somewhere
  in the curriculum (tested).
- `estimatedMinutes` stays honest: ~6–10 items ≈ 4–6 minutes.
- **The course is 30–40 lessons** (`tests/unit/seed-content.test.ts`); it is at
  39. Adding two or more lessons is a course-design decision — ask before
  raising the limit, and consider extending an existing lesson instead.

## Changing existing content

- Items are matched on **normalised Slovene** (lowercase, diacritics folded;
  lexemes on normalised Slovene + part of speech). Editing the German or
  context note updates in place on re-import.
- **Editing the Slovene creates a new item** on re-import (it no longer
  matches), and the old one stays — with her review history attached. Tell the
  teacher; fixing a typo in Slovene on a live deployment is better done in the
  teacher area's item editor, which keeps the cards and regenerates audio.
- New items import as `draft` unless `--activate`; generated audio follows
  with `pnpm audio:generate`.

## Verify

```bash
pnpm vitest run tests/unit/seed-content.test.ts   # schema, slugs, cloze tokens, case order, dual
pnpm check
```

With a dev database (`pnpm dev:db` + `DB_POOL_MAX=1`):
`pnpm seed:content --curriculum-only` and read its report — it lists every
match and update rather than skipping silently.

Update the counts in `seed/README.md` (units / lessons / items / grammar
notes) and `README.md` → "Content" if they change.
