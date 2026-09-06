# Seed data

Everything in this directory is checked in and versioned. A deployment never
downloads anything — `pnpm seed:content` reads only these files.

## Files

| File | Contents | Produced by |
| --- | --- | --- |
| `frequency-lexemes.json` | 1100 lemmas ranked by spoken frequency, with part of speech, gender and aspect | `pnpm seed:build-deck` |
| `frequency-word-forms.json` | ~22 600 inflected forms for those lemmas, with case, number (including **dual**), gender, person and verb form | `pnpm seed:build-deck` |
| `curriculum/*.json` | 10 units, 39 lessons, 302 items, 26 grammar notes | hand-written |

## Sources and licences

The deck is built from three openly licensed sources. Nothing here was scraped
and nothing requires a licence to redistribute — but the attribution below has
to travel with the data.

**1. Spoken-word frequencies — OpenSubtitles 2018 (Slovene)**
[hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords),
derived from the OpenSubtitles corpus, CC BY-SA 4.0.
Chosen over the larger written corpora because subtitles are dialogue: the
register of a family dinner, not of a newspaper.

**2. Lemmas and paradigms — Sloleks 3.0**
[CLARIN.SI, hdl:11356/1745](https://www.clarin.si/repository/xmlui/handle/11356/1745),
CC BY-SA 4.0. Supplies the lemma for each word form, the part of speech,
noun gender, verb aspect, and the complete inflectional paradigm — which is
where the dual and the six cases come from.

**3. German glosses — German Wiktionary via kaikki.org**
[kaikki.org/dewiktionary](https://kaikki.org/dewiktionary/Slowenisch/), derived
from de.wiktionary.org, CC BY-SA 3.0.

The curriculum files are original work for this app.

## How the deck is built

`scripts/seed/build-deck.mjs` downloads the three sources into `.seed-cache/`
(gitignored, ~250 MB for Sloleks) and does the following:

1. Reads the top 25 000 OpenSubtitles word forms.
2. Streams all 107 Sloleks XML files, keeping entries that are hand-checked or
   reasonably frequent in Gigafida, and dropping proper nouns.
3. Resolves homographs. This is the part that matters: naively summing form
   frequencies gives every lemma sharing a form the full count, so `kaja`
   inherits all of `kaj` and the deck fills with words nobody says. Each form's
   frequency is attributed to exactly one lemma — the one best attested in
   Gigafida — before anything is ranked.
4. Keeps one lemma per headword, ranks by spoken frequency, takes the top 1100.
5. Attaches German glosses, skipping Wiktionary senses that describe grammar
   ("3. Person Singular Indikativ …") rather than meaning.

Re-running reuses a cached candidate scan; `RESCAN=1` forces a full re-read.

## Known gaps

- **About 950 of the 1100 deck lemmas have no German gloss.** German Wiktionary
  covers Slovene thinly, and machine-translating the rest would put unreviewed
  translations in front of a beginner. They import with an empty gloss and are
  meant to be filled through the teacher UI or the AI draft tool, where each one
  gets looked at before it becomes a card.
- **`sem` is listed as an adverb.** It is genuinely an adverb ("hierher"), but
  it is also the present tense of *biti*, which is why it ranks so high. The
  frequency attributed to it belongs mostly to *biti*. Harmless, and correctable
  in the content browser.
- **Word-form links in phrases are a best guess.** `sestri` is both dative
  singular and nominative dual; without a tagger the importer picks
  deterministically (most frequent lemma first). The link is a hint, not a
  claim.

## Importing

```bash
pnpm seed:content              # import everything as drafts
pnpm seed:content --activate   # import and make it live
pnpm seed:content --curriculum-only
```

Content lands as `draft` by default. Items are matched on their normalised
Slovene form, so re-running updates in place instead of duplicating — the
importer reports every match rather than silently skipping it.
