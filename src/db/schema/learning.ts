import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { clozeItems, lessons, lexemes, phrases } from "./content";
import {
  exerciseTypeEnum,
  fsrsStateEnum,
  ratingEnum,
  ratingSourceEnum,
  speechBandEnum,
  speechStatusEnum,
  studySessionKindEnum,
  studySessionStatusEnum,
} from "./enums";

/**
 * The unit FSRS schedules: one (item, exercise type) pair for one user.
 * Exactly one of lexemeId / phraseId / clozeItemId is set.
 */
export const cards = pgTable(
  "cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lexemeId: uuid("lexeme_id").references(() => lexemes.id, { onDelete: "cascade" }),
    phraseId: uuid("phrase_id").references(() => phrases.id, { onDelete: "cascade" }),
    clozeItemId: uuid("cloze_item_id").references(() => clozeItems.id, { onDelete: "cascade" }),
    exerciseType: exerciseTypeEnum("exercise_type").notNull(),
    /** Which lesson handed this card to FSRS, for the progress view. */
    introducedByLessonId: uuid("introduced_by_lesson_id").references(() => lessons.id, {
      onDelete: "set null",
    }),
    introducedAt: timestamp("introduced_at", { withTimezone: true }),

    // --- FSRS-5 scheduler state, mirrored from ts-fsrs ---
    due: timestamp("due", { withTimezone: true }).notNull().defaultNow(),
    stability: doublePrecision("stability").notNull().default(0),
    difficulty: doublePrecision("difficulty").notNull().default(0),
    elapsedDays: doublePrecision("elapsed_days").notNull().default(0),
    scheduledDays: doublePrecision("scheduled_days").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    state: fsrsStateEnum("state").notNull().default("new"),
    lastReview: timestamp("last_review", { withTimezone: true }),
    /** ts-fsrs learning_steps counter for cards inside a learning phase. */
    learningSteps: integer("learning_steps").notNull().default(0),

    suspended: boolean("suspended").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cards_user_due_idx").on(t.userId, t.due),
    index("cards_user_state_idx").on(t.userId, t.state),
    index("cards_lexeme_idx").on(t.lexemeId),
    index("cards_phrase_idx").on(t.phraseId),
    index("cards_cloze_idx").on(t.clozeItemId),
    unique("cards_unique_lexeme").on(t.userId, t.lexemeId, t.exerciseType),
    unique("cards_unique_phrase").on(t.userId, t.phraseId, t.exerciseType),
    unique("cards_unique_cloze").on(t.userId, t.clozeItemId, t.exerciseType),
  ],
);

/**
 * Every grading event, append-only. This is the input for FSRS parameter
 * optimisation and for the weekly digest — never delete rows here.
 */
export const reviewLogs = pgTable(
  "review_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studySessionId: uuid("study_session_id"),
    rating: ratingEnum("rating").notNull(),
    ratingSource: ratingSourceEnum("rating_source").notNull().default("manual"),

    // --- scheduler state as ts-fsrs recorded it for this review ---
    state: fsrsStateEnum("state").notNull(),
    due: timestamp("due", { withTimezone: true }).notNull(),
    stability: doublePrecision("stability").notNull(),
    difficulty: doublePrecision("difficulty").notNull(),
    elapsedDays: doublePrecision("elapsed_days").notNull(),
    lastElapsedDays: doublePrecision("last_elapsed_days").notNull(),
    scheduledDays: doublePrecision("scheduled_days").notNull(),
    learningSteps: integer("learning_steps").notNull().default(0),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),

    /** Card state after scheduling, kept so the digest needs no replay. */
    stateAfter: jsonb("state_after").$type<Record<string, unknown>>(),
    /** How long she looked at the card. */
    durationMs: integer("duration_ms"),
    /** Set when the review was recorded offline and synced later. */
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    /*
     * Idempotency key minted by the browser when the answer was given.
     *
     * A sync that half-succeeds gets retried, and without this a card would be
     * graded twice — which does not just duplicate a row, it moves her
     * schedule. Unique, so the retry collides instead.
     */
    clientEventId: text("client_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("review_logs_card_idx").on(t.cardId),
    index("review_logs_user_time_idx").on(t.userId, t.reviewedAt),
    unique("review_logs_client_event_unique").on(t.clientEventId),
  ],
);

/** One recorded attempt at saying something, plus what the ASR made of it. */
export const speechAttempts = pgTable(
  "speech_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cardId: uuid("card_id").references(() => cards.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studySessionId: uuid("study_session_id"),
    /** What she was asked to say. */
    targetText: text("target_text").notNull(),
    /** Path relative to MEDIA_ROOT. Audio is kept by default; it is two users. */
    audioPath: text("audio_path").notNull(),
    mimeType: text("mime_type"),
    durationMs: integer("duration_ms"),
    transcript: text("transcript"),
    /** Character-level Levenshtein ratio, 0..1. */
    charSimilarity: real("char_similarity"),
    /** Word-level agreement, 0..1. */
    wordSimilarity: real("word_similarity"),
    band: speechBandEnum("band"),
    /** What the scorer would suggest; she still taps the rating herself. */
    suggestedRating: ratingEnum("suggested_rating"),
    status: speechStatusEnum("status").notNull().default("pending"),
    /** Which ASR produced the transcript, so results stay comparable. */
    engine: text("engine"),
    engineModel: text("engine_model"),
    errorMessage: text("error_message"),
    /** Same idempotency key, for recordings that were made offline. */
    clientEventId: text("client_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
  },
  (t) => [
    index("speech_attempts_user_time_idx").on(t.userId, t.createdAt),
    unique("speech_attempts_client_event_unique").on(t.clientEventId),
    index("speech_attempts_card_idx").on(t.cardId),
    index("speech_attempts_status_idx").on(t.status),
  ],
);

/**
 * A study session. State lives server-side so closing the app mid-session
 * loses nothing.
 */
export const studySessions = pgTable(
  "study_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: studySessionKindEnum("kind").notNull().default("review"),
    status: studySessionStatusEnum("status").notNull().default("active"),
    lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
    /** Ordered card ids plus the current position — the resumable queue. */
    queue: jsonb("queue").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    cursor: integer("cursor").notNull().default(0),
    /** Caps and mix in force when the session was built. */
    config: jsonb("config").$type<Record<string, unknown>>(),
    answeredCount: integer("answered_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("study_sessions_user_status_idx").on(t.userId, t.status),
    index("study_sessions_user_time_idx").on(t.userId, t.startedAt),
  ],
);

/** Per-user knobs. Defaults match the spec; both users get a row. */
export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Hard cap on review cards per session — the backlog is never dumped. */
  reviewCap: integer("review_cap").notNull().default(20),
  dailyNewLimit: integer("daily_new_limit").notNull().default(8),
  /** Above this many overdue cards, no new material is introduced. Silently. */
  newMaterialBacklogThreshold: integer("new_material_backlog_threshold").notNull().default(60),
  /** Relative weights per exercise type; speaking and listening lead. */
  exerciseMix: jsonb("exercise_mix")
    .$type<Record<string, number>>()
    .notNull()
    .default(
      sql`'{"speaking":3,"listening":3,"recognition":2,"production":2,"cloze":1,"dictation":1}'::jsonb`,
    ),
  autoplayAudio: boolean("autoplay_audio").notNull().default(true),
  theme: text("theme").notNull().default("system"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Result of an FSRS parameter optimisation run. Logged, never applied
 * silently — the spec is explicit about that.
 */
export const fsrsOptimizationRuns = pgTable("fsrs_optimization_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  reviewCount: integer("review_count").notNull(),
  parameters: jsonb("parameters").$type<number[]>().notNull(),
  logLoss: doublePrecision("log_loss"),
  rmse: doublePrecision("rmse"),
  applied: boolean("applied").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cardsRelations = relations(cards, ({ one, many }) => ({
  user: one(users, { fields: [cards.userId], references: [users.id] }),
  lexeme: one(lexemes, { fields: [cards.lexemeId], references: [lexemes.id] }),
  phrase: one(phrases, { fields: [cards.phraseId], references: [phrases.id] }),
  clozeItem: one(clozeItems, { fields: [cards.clozeItemId], references: [clozeItems.id] }),
  reviewLogs: many(reviewLogs),
  speechAttempts: many(speechAttempts),
}));

export const reviewLogsRelations = relations(reviewLogs, ({ one }) => ({
  card: one(cards, { fields: [reviewLogs.cardId], references: [cards.id] }),
  user: one(users, { fields: [reviewLogs.userId], references: [users.id] }),
}));

export const speechAttemptsRelations = relations(speechAttempts, ({ one }) => ({
  card: one(cards, { fields: [speechAttempts.cardId], references: [cards.id] }),
  user: one(users, { fields: [speechAttempts.userId], references: [users.id] }),
}));

export const studySessionsRelations = relations(studySessions, ({ one }) => ({
  user: one(users, { fields: [studySessions.userId], references: [users.id] }),
  lesson: one(lessons, { fields: [studySessions.lessonId], references: [lessons.id] }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));
