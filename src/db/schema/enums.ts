import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["learner", "teacher"]);

/** Where a piece of content came from. AI content always starts as a draft. */
export const contentSourceEnum = pgEnum("content_source", ["seed", "ai", "teacher"]);
export const contentStatusEnum = pgEnum("content_status", ["draft", "active", "archived"]);

export const partOfSpeechEnum = pgEnum("part_of_speech", [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "numeral",
  "preposition",
  "conjunction",
  "particle",
  "interjection",
  "phrase",
  "other",
]);

export const genderEnum = pgEnum("gender", ["m", "f", "n"]);

/** Slovene verbs come in perfective/imperfective pairs; a few are biaspectual. */
export const aspectEnum = pgEnum("aspect", ["perfective", "imperfective", "biaspectual"]);

/**
 * Cases are listed in the order we teach them (usefulness for conversation),
 * not in the traditional grammar-table order.
 */
export const grammaticalCaseEnum = pgEnum("grammatical_case", [
  "nominative",
  "accusative",
  "locative",
  "genitive",
  "dative",
  "instrumental",
]);

/** Slovene has a dual alongside singular and plural. */
export const grammaticalNumberEnum = pgEnum("grammatical_number", ["singular", "dual", "plural"]);

export const personEnum = pgEnum("grammatical_person", ["first", "second", "third"]);

/** Verb form slots we care about for beginner conversation. */
export const verbFormEnum = pgEnum("verb_form", [
  "infinitive",
  "present",
  "past_participle",
  "imperative",
  "future",
  "conditional",
  "supine",
]);

/** How standard a form is. The family speaks real Slovene, not textbook Slovene. */
export const registerEnum = pgEnum("register", ["standard", "colloquial", "regional", "formal"]);

export const exerciseTypeEnum = pgEnum("exercise_type", [
  "recognition",
  "production",
  "listening",
  "speaking",
  "cloze",
  "dictation",
]);

export const mediaKindEnum = pgEnum("media_kind", ["tts", "human_recording"]);

export const fsrsStateEnum = pgEnum("fsrs_state", ["new", "learning", "review", "relearning"]);

export const ratingEnum = pgEnum("rating", ["again", "hard", "good", "easy"]);

/** Where a rating came from, so we can audit automatic grading later. */
export const ratingSourceEnum = pgEnum("rating_source", ["manual", "auto_speech", "overridden"]);

export const speechBandEnum = pgEnum("speech_band", ["good", "close", "off"]);

export const speechStatusEnum = pgEnum("speech_status", ["pending", "scored", "failed", "skipped"]);

export const questionStatusEnum = pgEnum("question_status", ["open", "answered"]);

export const studySessionKindEnum = pgEnum("study_session_kind", ["review", "lesson", "mixed"]);

export const studySessionStatusEnum = pgEnum("study_session_status", [
  "active",
  "completed",
  "abandoned",
]);

/** What a generation run was asked to produce. */
export const generationKindEnum = pgEnum("generation_kind", [
  "mixed",
  "phrases",
  "lexemes",
  "cloze",
]);

export const generationRunStatusEnum = pgEnum("generation_run_status", [
  "pending",
  "succeeded",
  "failed",
]);

/** A proposal is pending until the teacher looks at it. Nothing auto-approves. */
export const generationDecisionEnum = pgEnum("generation_decision", [
  "pending",
  "approved",
  "rejected",
]);
