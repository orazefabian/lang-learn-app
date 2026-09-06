import { relations, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import {
  aspectEnum,
  contentSourceEnum,
  contentStatusEnum,
  genderEnum,
  grammaticalCaseEnum,
  grammaticalNumberEnum,
  mediaKindEnum,
  partOfSpeechEnum,
  personEnum,
  registerEnum,
  verbFormEnum,
} from "./enums";

/** A Slovene word or fixed expression, in its dictionary form. */
export const lexemes = pgTable(
  "lexemes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Citation form: nominative singular for nouns, infinitive for verbs. */
    slovene: text("slovene").notNull(),
    /** Lowercased, diacritics folded. Used for dedup checks and lenient matching. */
    sloveneNormalized: text("slovene_normalized").notNull(),
    german: jsonb("german").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    partOfSpeech: partOfSpeechEnum("part_of_speech").notNull().default("other"),
    gender: genderEnum("gender"),
    aspect: aspectEnum("aspect"),
    /** The other half of a perfective/imperfective pair, e.g. kupiti <-> kupovati. */
    aspectPartnerId: uuid("aspect_partner_id").references((): AnyPgColumn => lexemes.id, {
      onDelete: "set null",
    }),
    register: registerEnum("register").notNull().default("standard"),
    /** Free-text label when a form is regional, e.g. "Štajersko". */
    regionLabel: text("region_label"),
    /** 1 (trivial) to 5 (hard). A rough ordering hint, not an FSRS input. */
    difficulty: integer("difficulty").notNull().default(2),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    notes: text("notes"),
    /** Frequency rank from the seed corpus, if the lexeme came from one. */
    frequencyRank: integer("frequency_rank"),
    source: contentSourceEnum("source").notNull().default("teacher"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    status: contentStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("lexemes_normalized_idx").on(t.sloveneNormalized),
    index("lexemes_status_idx").on(t.status),
    index("lexemes_pos_idx").on(t.partOfSpeech),
    index("lexemes_frequency_idx").on(t.frequencyRank),
  ],
);

/**
 * One inflected form of a lexeme. Features are columns rather than a JSON blob
 * so cloze generation can ask for something specific ("locative dual of miza")
 * without scanning paradigms in application code.
 */
export const wordForms = pgTable(
  "word_forms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    lexemeId: uuid("lexeme_id")
      .notNull()
      .references(() => lexemes.id, { onDelete: "cascade" }),
    form: text("form").notNull(),
    formNormalized: text("form_normalized").notNull(),
    grammaticalCase: grammaticalCaseEnum("grammatical_case"),
    number: grammaticalNumberEnum("number"),
    gender: genderEnum("gender"),
    person: personEnum("person"),
    verbForm: verbFormEnum("verb_form"),
    /** Adjective degree: positive | comparative | superlative. */
    degree: text("degree"),
    /** Adjective definiteness: definite | indefinite. */
    definiteness: text("definiteness"),
    /** Raw morphosyntactic descriptor from the source lexicon (e.g. Sloleks MSD). */
    msd: text("msd"),
    /** The form shown as the headword variant in lessons. */
    isCanonical: boolean("is_canonical").notNull().default(false),
    source: contentSourceEnum("source").notNull().default("seed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("word_forms_lexeme_idx").on(t.lexemeId),
    index("word_forms_normalized_idx").on(t.formNormalized),
    index("word_forms_features_idx").on(t.lexemeId, t.grammaticalCase, t.number),
  ],
);

/** A full utterance she could say to a person. */
export const phrases = pgTable(
  "phrases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slovene: text("slovene").notNull(),
    sloveneNormalized: text("slovene_normalized").notNull(),
    german: text("german").notNull(),
    /** When and to whom you say this — the thing that makes it stick. */
    contextNote: text("context_note"),
    register: registerEnum("register").notNull().default("standard"),
    regionLabel: text("region_label"),
    difficulty: integer("difficulty").notNull().default(2),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    notes: text("notes"),
    source: contentSourceEnum("source").notNull().default("teacher"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    status: contentStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("phrases_normalized_idx").on(t.sloveneNormalized),
    index("phrases_status_idx").on(t.status),
  ],
);

/** Which lexemes appear in a phrase, and in which inflected form. */
export const phraseLexemes = pgTable(
  "phrase_lexemes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phraseId: uuid("phrase_id")
      .notNull()
      .references(() => phrases.id, { onDelete: "cascade" }),
    lexemeId: uuid("lexeme_id")
      .notNull()
      .references(() => lexemes.id, { onDelete: "cascade" }),
    wordFormId: uuid("word_form_id").references(() => wordForms.id, { onDelete: "set null" }),
    /** Token index in the phrase, so cloze blanks can point at one occurrence. */
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("phrase_lexemes_phrase_idx").on(t.phraseId),
    index("phrase_lexemes_lexeme_idx").on(t.lexemeId),
    unique("phrase_lexemes_unique").on(t.phraseId, t.lexemeId, t.position),
  ],
);

/**
 * An explicit cloze target: one blanked token in a phrase, chosen to exercise a
 * case ending or verb form. Grammar is practised here, never as a table.
 */
export const clozeItems = pgTable(
  "cloze_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phraseId: uuid("phrase_id")
      .notNull()
      .references(() => phrases.id, { onDelete: "cascade" }),
    /** Token index of the blank within the phrase. */
    position: integer("position").notNull(),
    /** The expected surface form. */
    answer: text("answer").notNull(),
    answerNormalized: text("answer_normalized").notNull(),
    wordFormId: uuid("word_form_id").references(() => wordForms.id, { onDelete: "set null" }),
    /** What this blank teaches, e.g. accusative singular. */
    focusCase: grammaticalCaseEnum("focus_case"),
    focusNumber: grammaticalNumberEnum("focus_number"),
    focusVerbForm: verbFormEnum("focus_verb_form"),
    /** Short German nudge shown on demand, e.g. "wohin? → Akkusativ". */
    hintDe: text("hint_de"),
    source: contentSourceEnum("source").notNull().default("seed"),
    status: contentStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cloze_items_phrase_idx").on(t.phraseId),
    unique("cloze_items_unique").on(t.phraseId, t.position),
  ],
);

export const units = pgTable("units", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  titleDe: text("title_de").notNull(),
  descriptionDe: text("description_de"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lessons = pgTable(
  "lessons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "set null" }),
    slug: text("slug").notNull().unique(),
    titleDe: text("title_de").notNull(),
    /** The teaching segment: plain-German explanation, markdown. */
    introDe: text("intro_de"),
    goalDe: text("goal_de"),
    position: integer("position").notNull().default(0),
    estimatedMinutes: integer("estimated_minutes").notNull().default(4),
    source: contentSourceEnum("source").notNull().default("seed"),
    status: contentStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lessons_unit_idx").on(t.unitId), index("lessons_position_idx").on(t.position)],
);

/** An item a lesson introduces. Exactly one of lexemeId / phraseId is set. */
export const lessonItems = pgTable(
  "lesson_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    lexemeId: uuid("lexeme_id").references(() => lexemes.id, { onDelete: "cascade" }),
    phraseId: uuid("phrase_id").references(() => phrases.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    /** Optional per-item aside shown during the lesson only. */
    teachingNoteDe: text("teaching_note_de"),
  },
  (t) => [index("lesson_items_lesson_idx").on(t.lessonId)],
);

/** Audio for an item. Multiple assets per item are expected and encouraged. */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: mediaKindEnum("kind").notNull(),
    lexemeId: uuid("lexeme_id").references(() => lexemes.id, { onDelete: "cascade" }),
    phraseId: uuid("phrase_id").references(() => phrases.id, { onDelete: "cascade" }),
    /** Who is speaking: "Papa", "Oma", "ich", or the TTS voice name. */
    speakerLabel: text("speaker_label"),
    /** Path relative to MEDIA_ROOT. */
    path: text("path").notNull(),
    mimeType: text("mime_type").notNull(),
    /** mp3 twin of an Opus/WebM asset, for browsers that need it. */
    fallbackPath: text("fallback_path"),
    durationMs: integer("duration_ms"),
    byteSize: integer("byte_size"),
    /** Hash of the text the audio voices, so edits invalidate the cache. */
    contentHash: text("content_hash"),
    /** Piper voice id for TTS assets. */
    voice: text("voice"),
    /** Human recordings win over TTS; higher sorts first. */
    priority: integer("priority").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("media_assets_lexeme_idx").on(t.lexemeId),
    index("media_assets_phrase_idx").on(t.phraseId),
    index("media_assets_hash_idx").on(t.contentHash),
  ],
);

/** Short plain-German grammar explanations, available on demand, never blocking. */
export const grammarNotes = pgTable("grammar_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  titleDe: text("title_de").notNull(),
  bodyDe: text("body_de").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  source: contentSourceEnum("source").notNull().default("seed"),
  status: contentStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Attaches a grammar note to any number of lexemes, phrases or lessons. */
export const grammarNoteLinks = pgTable(
  "grammar_note_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => grammarNotes.id, { onDelete: "cascade" }),
    lexemeId: uuid("lexeme_id").references(() => lexemes.id, { onDelete: "cascade" }),
    phraseId: uuid("phrase_id").references(() => phrases.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("grammar_note_links_note_idx").on(t.noteId),
    index("grammar_note_links_lexeme_idx").on(t.lexemeId),
    index("grammar_note_links_phrase_idx").on(t.phraseId),
    index("grammar_note_links_lesson_idx").on(t.lessonId),
  ],
);

export const lexemesRelations = relations(lexemes, ({ many, one }) => ({
  forms: many(wordForms),
  media: many(mediaAssets),
  phraseLinks: many(phraseLexemes),
  aspectPartner: one(lexemes, {
    fields: [lexemes.aspectPartnerId],
    references: [lexemes.id],
    relationName: "aspectPair",
  }),
}));

export const wordFormsRelations = relations(wordForms, ({ one }) => ({
  lexeme: one(lexemes, { fields: [wordForms.lexemeId], references: [lexemes.id] }),
}));

export const phrasesRelations = relations(phrases, ({ many }) => ({
  lexemeLinks: many(phraseLexemes),
  clozeItems: many(clozeItems),
  media: many(mediaAssets),
}));

export const phraseLexemesRelations = relations(phraseLexemes, ({ one }) => ({
  phrase: one(phrases, { fields: [phraseLexemes.phraseId], references: [phrases.id] }),
  lexeme: one(lexemes, { fields: [phraseLexemes.lexemeId], references: [lexemes.id] }),
  wordForm: one(wordForms, { fields: [phraseLexemes.wordFormId], references: [wordForms.id] }),
}));

export const clozeItemsRelations = relations(clozeItems, ({ one }) => ({
  phrase: one(phrases, { fields: [clozeItems.phraseId], references: [phrases.id] }),
  wordForm: one(wordForms, { fields: [clozeItems.wordFormId], references: [wordForms.id] }),
}));

export const unitsRelations = relations(units, ({ many }) => ({ lessons: many(lessons) }));

export const lessonsRelations = relations(lessons, ({ one, many }) => ({
  unit: one(units, { fields: [lessons.unitId], references: [units.id] }),
  items: many(lessonItems),
}));

export const lessonItemsRelations = relations(lessonItems, ({ one }) => ({
  lesson: one(lessons, { fields: [lessonItems.lessonId], references: [lessons.id] }),
  lexeme: one(lexemes, { fields: [lessonItems.lexemeId], references: [lexemes.id] }),
  phrase: one(phrases, { fields: [lessonItems.phraseId], references: [phrases.id] }),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one }) => ({
  lexeme: one(lexemes, { fields: [mediaAssets.lexemeId], references: [lexemes.id] }),
  phrase: one(phrases, { fields: [mediaAssets.phraseId], references: [phrases.id] }),
}));

export const grammarNotesRelations = relations(grammarNotes, ({ many }) => ({
  links: many(grammarNoteLinks),
}));

export const grammarNoteLinksRelations = relations(grammarNoteLinks, ({ one }) => ({
  note: one(grammarNotes, { fields: [grammarNoteLinks.noteId], references: [grammarNotes.id] }),
}));
