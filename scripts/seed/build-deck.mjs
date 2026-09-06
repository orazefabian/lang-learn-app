import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

/**
 * Builds the versioned frequency deck from three openly licensed sources:
 *
 *   1. OpenSubtitles 2018 Slovene word frequencies (hermitdave/FrequencyWords,
 *      CC BY-SA 4.0) — spoken register, which is what she needs at a dinner
 *      table. Word forms only, no lemmas.
 *   2. Sloleks 3.0 (CLARIN.SI, CC BY-SA 4.0) — lemmas, part of speech, gender,
 *      aspect and full inflectional paradigms including the dual.
 *   3. German Wiktionary via kaikki.org (CC BY-SA 3.0) — German glosses.
 *
 * Output is checked into seed/ so a deployment never needs these downloads.
 * Run with: pnpm seed:build-deck
 */

const CACHE = ".seed-cache";
const OUT = "seed";
const SLOLEKS_ZIP = path.join(CACHE, "sloleks3.zip");
const FREQ_FILE = path.join(CACHE, "opensubtitles-sl-50k.txt");
const GLOSS_FILE = path.join(CACHE, "dewiktionary-sl.jsonl");

/** How many lemmas end up in the deck. */
const DECK_SIZE = Number(process.env.DECK_SIZE ?? 1100);
/** Frequency ranks below this are noise for a beginner. */
const FREQ_CUTOFF = Number(process.env.FREQ_CUTOFF ?? 25000);

const CATEGORY_TO_POS = {
  noun: "noun",
  verb: "verb",
  adjective: "adjective",
  adverb: "adverb",
  pronoun: "pronoun",
  numeral: "numeral",
  preposition: "preposition",
  conjunction: "conjunction",
  particle: "particle",
  interjection: "interjection",
  abbreviation: "other",
  residual: "other",
};

const CASE_MAP = {
  nominative: "nominative",
  genitive: "genitive",
  dative: "dative",
  accusative: "accusative",
  locative: "locative",
  instrumental: "instrumental",
};

const NUMBER_MAP = { singular: "singular", dual: "dual", plural: "plural" };
const PERSON_MAP = { first: "first", second: "second", third: "third" };
const VFORM_MAP = {
  infinitive: "infinitive",
  present: "present",
  participle: "past_participle",
  imperative: "imperative",
  future: "future",
  conditional: "conditional",
  supine: "supine",
};

/** Diacritics folded, lowercased — the normalisation the app uses everywhere. */
function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9' -]/g, "")
    .trim();
}

async function loadFrequencies() {
  const text = await readFile(FREQ_FILE, "utf8");
  const forms = new Map();
  let rank = 0;
  for (const line of text.split("\n")) {
    const [word, count] = line.trim().split(" ");
    if (!word || !count) continue;
    rank += 1;
    if (rank > FREQ_CUTOFF) break;
    forms.set(word.toLowerCase(), Number(count));
  }
  return forms;
}

/**
 * German Wiktionary glosses are definitions, not translations. The convention
 * there is to end with the plain German equivalent after a semicolon, so we
 * prefer that tail and fall back to the whole definition.
 */
/** Marks a Wiktionary sense that explains a word form instead of translating it. */
const GRAMMAR_GLOSS =
  /(Person (Singular|Dual|Plural))|Indikativ|Konjunktiv|Imperativ|Präsens|Präteritum|Partizip|Kurzform (zu|von)|Deklinierte Form|Genitiv|Dativ|Akkusativ|Lokativ|Instrumental|Nominativ|des Verbs|des Substantivs|des Adjektivs|Buchstabe/i;

async function loadGlosses() {
  const text = await readFile(GLOSS_FILE, "utf8");
  const byWord = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if (entry.lang_code !== "sl" || !entry.word) continue;
    if (["character", "name", "abbrev"].includes(entry.pos)) continue;

    const glosses = [];
    for (const sense of entry.senses ?? []) {
      for (const gloss of sense.glosses ?? []) {
        // Wiktionary entries for inflected forms describe grammar rather than
        // meaning ("3. Person Singular Indikativ Präsens des Verbs dati").
        // Those are not translations and must not reach her cards.
        if (GRAMMAR_GLOSS.test(gloss)) continue;
        const tail = gloss.includes(";") ? gloss.slice(gloss.lastIndexOf(";") + 1).trim() : gloss;
        const candidate = (tail.length >= 2 && tail.length <= 60 ? tail : gloss).trim();
        // A long candidate is a definition, not a gloss; keep the deck usable.
        if (!candidate || candidate.length > 60) continue;
        glosses.push(candidate);
      }
    }
    if (!glosses.length) continue;

    const existing = byWord.get(entry.word) ?? [];
    byWord.set(entry.word, [...existing, ...glosses].slice(0, 3));
  }
  return byWord;
}

function parseGrammarFeatures(block) {
  const features = {};
  const re = /<grammarFeature name="([^"]+)"[^>]*>([^<]*)<\/grammarFeature>/g;
  let match;
  while ((match = re.exec(block))) features[match[1]] = match[2];
  return features;
}

/** Which forms are worth storing. Full paradigms would bloat the seed files. */
function keepForm(pos, features) {
  if (pos === "adjective") {
    if (features.degree && features.degree !== "positive") return false;
    return ["nominative", "accusative", "locative", "genitive"].includes(features.case ?? "");
  }
  if (pos === "verb") {
    return ["infinitive", "present", "participle", "imperative", "supine"].includes(
      features.vform ?? "",
    );
  }
  return true;
}

function parseEntry(xml) {
  const lemma = /<lemma>([^<]+)<\/lemma>/.exec(xml)?.[1];
  if (!lemma) return null;

  const category = /<category>([^<]+)<\/category>/.exec(xml)?.[1] ?? "";
  const pos = CATEGORY_TO_POS[category] ?? "other";

  const headEnd = xml.indexOf("</head>");
  const head = headEnd === -1 ? xml : xml.slice(0, headEnd);
  const headFeatures = parseGrammarFeatures(head);
  if (headFeatures.type === "proper") return null;

  // Sloleks 3.0 mixes hand-checked entries with automatically generated ones.
  // A lemma that is neither hand-checked nor reasonably common in Gigafida is
  // not beginner vocabulary, and its forms are often homographs of real words.
  const manual = /<status>MANUAL<\/status>/.test(head);

  const gigafida = Number(
    /<measure type="frequency"[^>]*>(\d+)<\/measure>/.exec(head)?.[1] ?? "0",
  );
  if (!manual && gigafida < 100) return null;
  if (gigafida < 20) return null;

  const forms = [];
  const formRe = /<wordForm>([\s\S]*?)<\/wordForm>/g;
  let match;
  while ((match = formRe.exec(xml))) {
    const block = match[1];
    const msd = /<msd[^>]*>([^<]*)<\/msd>/.exec(block)?.[1] ?? null;
    const features = parseGrammarFeatures(block);
    if (!keepForm(pos, features)) continue;

    // Only the orthographic forms; accentuation and IPA live in the same block.
    const orthography = /<orthographyList>([\s\S]*?)<\/orthographyList>/.exec(block)?.[1] ?? "";
    const surfaceRe = /<form>([^<]+)<\/form>/g;
    let surface;
    while ((surface = surfaceRe.exec(orthography))) {
      forms.push({
        form: surface[1],
        msd,
        case: CASE_MAP[features.case] ?? null,
        number: NUMBER_MAP[features.number] ?? null,
        gender: features.gender ? features.gender[0] : null,
        person: PERSON_MAP[features.person] ?? null,
        verbForm: VFORM_MAP[features.vform] ?? null,
        degree: features.degree ?? null,
        definiteness: features.definiteness ?? null,
      });
    }
  }

  if (!forms.length) return null;

  // Gender of a noun is a property of the lexeme; read it off any form.
  // Nouns carry gender on the entry; other parts of speech only on forms.
  const gender =
    pos === "noun"
      ? (headFeatures.gender?.[0] ?? forms.find((f) => f.gender)?.gender ?? null)
      : null;
  // Sloleks calls the imperfective aspect "progressive".
  const rawAspect = pos === "verb" ? headFeatures.aspect : null;
  const aspect =
    rawAspect === "progressive"
      ? "imperfective"
      : rawAspect === "perfective"
        ? "perfective"
        : rawAspect === "bi-aspectual"
          ? "biaspectual"
          : null;

  return { lemma, pos, gender, aspect, gigafida, forms };
}

/** Streams one XML member of the zip through the entry parser. */
function streamMember(member, onEntry) {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-p", SLOLEKS_ZIP, member]);
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("</entry>")) !== -1) {
        const xml = buffer.slice(0, index);
        buffer = buffer.slice(index + "</entry>".length);
        const start = xml.indexOf("<entry>");
        if (start !== -1) onEntry(xml.slice(start));
      }
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`unzip ${member} exited ${code}`))));
  });
}

async function listMembers() {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-Z1", SLOLEKS_ZIP]);
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("error", reject);
    child.on("close", () =>
      resolve(out.split("\n").filter((line) => line.trim().endsWith(".xml"))),
    );
  });
}

async function main() {
  console.log("loading frequency list …");
  const frequencies = await loadFrequencies();
  console.log(`  ${frequencies.size} word forms`);

  console.log("loading German glosses …");
  const glosses = await loadGlosses();
  console.log(`  ${glosses.size} glossed words`);

  const cachePath = path.join(CACHE, "sloleks-candidates.json");
  if (!process.env.RESCAN && !process.env.SLOLEKS_MAX_FILES) {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8"));
      console.log(`reusing ${cached.length} cached candidates (RESCAN=1 to rebuild)`);
      return finish(cached, frequencies, glosses);
    } catch {
      // No cache yet — fall through to the full scan.
    }
  }

  console.log("scanning Sloleks (this takes a few minutes) …");
  const allMembers = await listMembers();
  // Smoke-test the pipeline on a slice before committing to the full 13 GB.
  const members = process.env.SLOLEKS_MAX_FILES
    ? allMembers.slice(0, Number(process.env.SLOLEKS_MAX_FILES))
    : allMembers;
  const candidates = new Map();
  let scanned = 0;

  for (const [index, member] of members.entries()) {
    await streamMember(member, (xml) => {
      scanned += 1;
      const entry = parseEntry(xml);
      if (!entry) return;

      // Spoken frequency of the lemma is the sum over its inflected forms.
      let spoken = 0;
      const seen = new Set();
      for (const form of entry.forms) {
        const key = form.form.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        spoken += frequencies.get(key) ?? 0;
      }
      if (spoken === 0) return;

      const existing = candidates.get(`${entry.lemma}|${entry.pos}`);
      if (existing && existing.spoken >= spoken) return;
      candidates.set(`${entry.lemma}|${entry.pos}`, { ...entry, spoken });
    });
    if ((index + 1) % 10 === 0) {
      console.log(`  ${index + 1}/${members.length} files, ${candidates.size} candidates`);
    }
  }

  console.log(`scanned ${scanned} entries, ${candidates.size} candidate lemmas`);

  const all = [...candidates.values()];
  if (!process.env.SLOLEKS_MAX_FILES) {
    await writeFile(cachePath, JSON.stringify(all));
    console.log(`cached candidates to ${cachePath}`);
  }
  return finish(all, frequencies, glosses);
}

/** Part-of-speech preference when one surface form is several lemmas. */
const POS_PRIORITY = {
  verb: 0,
  noun: 1,
  pronoun: 2,
  adjective: 3,
  adverb: 4,
  preposition: 5,
  conjunction: 6,
  numeral: 7,
  particle: 8,
  interjection: 9,
  other: 10,
};

/**
 * Ranks the candidates and writes the seed files.
 *
 * The delicate part is homographs. Summing raw form frequencies gives every
 * lemma sharing a form the full count, which floats rare words to the top:
 * `kaja` inherits all of `kaj`, and the deck fills with nouns nobody says.
 * Each form's frequency is therefore attributed to exactly one lemma — the one
 * that is most common in Gigafida — before anything is ranked.
 */
function finish(candidates, frequencies, glosses) {
  // One lemma per (surface form, part of speech); keep the best-attested entry.
  const byLemma = new Map();
  for (const entry of candidates) {
    const key = `${entry.lemma}|${entry.pos}`;
    const existing = byLemma.get(key);
    if (!existing || existing.gigafida < entry.gigafida) byLemma.set(key, entry);
  }

  // Then one lemma per surface form: `ne` is a particle, not also a conjunction.
  const byHeadword = new Map();
  for (const entry of byLemma.values()) {
    const existing = byHeadword.get(entry.lemma);
    if (!existing) {
      byHeadword.set(entry.lemma, entry);
      continue;
    }
    const better =
      entry.gigafida !== existing.gigafida
        ? entry.gigafida > existing.gigafida
        : POS_PRIORITY[entry.pos] < POS_PRIORITY[existing.pos];
    if (better) byHeadword.set(entry.lemma, entry);
  }

  const entries = [...byHeadword.values()];

  // Attribute each inflected form to its most plausible lemma.
  const claimants = new Map();
  for (const entry of entries) {
    for (const { form } of entry.forms) {
      const key = form.toLowerCase();
      const current = claimants.get(key);
      if (!current || current.gigafida < entry.gigafida) claimants.set(key, entry);
    }
  }

  for (const entry of entries) entry.spoken = 0;
  for (const [form, count] of frequencies) {
    const owner = claimants.get(form);
    if (owner) owner.spoken += count;
  }

  const ranked = entries
    .filter((entry) => entry.spoken > 0)
    .sort((a, b) => b.spoken - a.spoken || b.gigafida - a.gigafida)
    .slice(0, DECK_SIZE);

  return write(ranked, glosses);
}

async function write(ranked, glosses) {
  const lexemes = [];
  const wordForms = [];
  let glossed = 0;

  for (const [index, entry] of ranked.entries()) {
    const german = glosses.get(entry.lemma) ?? [];
    if (german.length) glossed += 1;

    lexemes.push({
      slovene: entry.lemma,
      sloveneNormalized: normalize(entry.lemma),
      german,
      partOfSpeech: entry.pos,
      gender: entry.gender,
      aspect: entry.aspect,
      frequencyRank: index + 1,
      spokenFrequency: entry.spoken,
      writtenFrequency: entry.gigafida,
      germanSource: german.length ? "dewiktionary" : null,
      tags: ["frequency-deck"],
    });

    for (const form of entry.forms) {
      wordForms.push({
        lemma: entry.lemma,
        partOfSpeech: entry.pos,
        form: form.form,
        formNormalized: normalize(form.form),
        msd: form.msd,
        grammaticalCase: form.case,
        number: form.number,
        gender: form.gender,
        person: form.person,
        verbForm: form.verbForm,
        degree: form.degree,
        definiteness: form.definiteness,
      });
    }
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(
    path.join(OUT, "frequency-lexemes.json"),
    `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), lexemes }, null, 1)}\n`,
  );
  await writeFile(
    path.join(OUT, "frequency-word-forms.json"),
    `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), wordForms }, null, 1)}\n`,
  );

  console.log(`wrote ${lexemes.length} lexemes and ${wordForms.length} word forms`);
  console.log(
    `  ${glossed} have a German gloss from Wiktionary (${Math.round((glossed / lexemes.length) * 100)}%)`,
  );
  console.log("  the rest need a gloss from the teacher or the AI draft tool");
}

await main();
