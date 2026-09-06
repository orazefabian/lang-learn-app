import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { clozeItems, lexemes, phrases } from "./content";
import { generationDecisionEnum, generationKindEnum, generationRunStatusEnum } from "./enums";

/**
 * A batch of AI-proposed content, kept as an audit trail.
 *
 * Nothing here is content she ever sees. The run records what was asked for and
 * what came back; the items it produced live in the normal content tables as
 * drafts, and stay drafts until the teacher approves them one by one.
 */
export const generationRuns = pgTable(
  "generation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    /** What was asked for, in the teacher's words. */
    topic: text("topic").notNull(),
    instructions: text("instructions"),
    kind: generationKindEnum("kind").notNull().default("mixed"),
    requestedCount: integer("requested_count").notNull().default(8),
    model: text("model").notNull(),
    status: generationRunStatusEnum("status").notNull().default("pending"),
    /** Why it failed, verbatim, so a broken key does not look like a broken app. */
    error: text("error"),
    /** What the model said about its own output — caveats, dialect notes. */
    modelNotes: text("model_notes"),
    proposedCount: integer("proposed_count").notNull().default(0),
    draftedCount: integer("drafted_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("generation_runs_created_idx").on(t.createdAt)],
);

/**
 * One proposal from a run.
 *
 * The payload is stored as the model returned it, next to the draft row it
 * became. That is deliberate: when something subtly wrong turns up in her deck
 * weeks later, the question "did the model write that or did I?" has an answer.
 */
export const generationItems = pgTable(
  "generation_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => generationRuns.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** The draft row this became. Null when it duplicated something existing. */
    phraseId: uuid("phrase_id").references(() => phrases.id, { onDelete: "set null" }),
    lexemeId: uuid("lexeme_id").references(() => lexemes.id, { onDelete: "set null" }),
    clozeItemId: uuid("cloze_item_id").references(() => clozeItems.id, { onDelete: "set null" }),
    /*
     * Duplicates are warned about, never silently dropped. The proposal stays
     * visible next to what it collided with, so approving it means "fill in
     * what the existing entry is missing" rather than adding a second copy.
     */
    duplicateOfPhraseId: uuid("duplicate_of_phrase_id").references(() => phrases.id, {
      onDelete: "set null",
    }),
    duplicateOfLexemeId: uuid("duplicate_of_lexeme_id").references(() => lexemes.id, {
      onDelete: "set null",
    }),
    decision: generationDecisionEnum("decision").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("generation_items_run_idx").on(t.runId),
    index("generation_items_decision_idx").on(t.decision),
  ],
);

export const generationRunsRelations = relations(generationRuns, ({ many }) => ({
  items: many(generationItems),
}));

export const generationItemsRelations = relations(generationItems, ({ one }) => ({
  run: one(generationRuns, {
    fields: [generationItems.runId],
    references: [generationRuns.id],
  }),
  phrase: one(phrases, { fields: [generationItems.phraseId], references: [phrases.id] }),
  lexeme: one(lexemes, { fields: [generationItems.lexemeId], references: [lexemes.id] }),
}));
