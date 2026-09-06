import { relations, sql } from "drizzle-orm";
import {
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
import { lessons, lexemes, mediaAssets, phrases } from "./content";
import { cards } from "./learning";
import { contentStatusEnum, questionStatusEnum } from "./enums";

/**
 * "Verstehe ich nicht" on a card. Filing one never blocks her session; the
 * answer attaches to the item permanently and shows on that card afterwards.
 */
export const questions = pgTable(
  "questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    askedBy: uuid("asked_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: uuid("card_id").references(() => cards.id, { onDelete: "set null" }),
    /** Denormalised item refs so the answer survives the card being rebuilt. */
    lexemeId: uuid("lexeme_id").references(() => lexemes.id, { onDelete: "cascade" }),
    phraseId: uuid("phrase_id").references(() => phrases.id, { onDelete: "cascade" }),
    /** Her optional free text. A question with no text is still a valid signal. */
    body: text("body"),
    status: questionStatusEnum("status").notNull().default("open"),
    answerText: text("answer_text"),
    answerMediaId: uuid("answer_media_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    answeredBy: uuid("answered_by").references(() => users.id, { onDelete: "set null" }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    /** When she saw the answer, so it can stop showing as new. */
    seenAt: timestamp("seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("questions_status_idx").on(t.status),
    index("questions_asked_by_idx").on(t.askedBy),
    index("questions_lexeme_idx").on(t.lexemeId),
    index("questions_phrase_idx").on(t.phraseId),
  ],
);

/** Progress through the lesson track. Lessons are ordered but not hard-gated. */
export const lessonProgress = pgTable(
  "lesson_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    /** Index into the lesson's item list, so a lesson resumes where she left it. */
    cursor: integer("cursor").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    unique("lesson_progress_unique").on(t.userId, t.lessonId),
    index("lesson_progress_user_idx").on(t.userId),
  ],
);

/** Weekly aggregate for the teacher, produced by a scheduled job. */
export const digestSnapshots = pgTable(
  "digest_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The learner the digest is about. */
    subjectUserId: uuid("subject_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** Reviewed counts, retention, struggling items, open questions. */
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
  },
  (t) => [
    unique("digest_snapshots_period_unique").on(t.subjectUserId, t.periodStart),
    index("digest_snapshots_generated_idx").on(t.generatedAt),
  ],
);

/** In-app notifications, e.g. "deine Frage wurde beantwortet". */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt)],
);

/**
 * Audit trail for AI content generation. The generated lexemes and phrases
 * live in their own tables with status "draft" and never reach her deck
 * before the teacher approves them.
 */
export const aiGenerationRuns = pgTable(
  "ai_generation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    instructions: text("instructions"),
    model: text("model").notNull(),
    /** Raw model output, kept so a bad batch can be diagnosed. */
    rawResponse: jsonb("raw_response"),
    lexemeCount: integer("lexeme_count").notNull().default(0),
    phraseCount: integer("phrase_count").notNull().default(0),
    clozeCount: integer("cloze_count").notNull().default(0),
    status: contentStatusEnum("status").notNull().default("draft"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_generation_runs_user_idx").on(t.requestedBy, t.createdAt)],
);

export const questionsRelations = relations(questions, ({ one }) => ({
  asker: one(users, { fields: [questions.askedBy], references: [users.id] }),
  card: one(cards, { fields: [questions.cardId], references: [cards.id] }),
  lexeme: one(lexemes, { fields: [questions.lexemeId], references: [lexemes.id] }),
  phrase: one(phrases, { fields: [questions.phraseId], references: [phrases.id] }),
  answerMedia: one(mediaAssets, {
    fields: [questions.answerMediaId],
    references: [mediaAssets.id],
  }),
}));

export const lessonProgressRelations = relations(lessonProgress, ({ one }) => ({
  user: one(users, { fields: [lessonProgress.userId], references: [users.id] }),
  lesson: one(lessons, { fields: [lessonProgress.lessonId], references: [lessons.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));
