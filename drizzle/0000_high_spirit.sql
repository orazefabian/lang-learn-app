CREATE TYPE "public"."aspect" AS ENUM('perfective', 'imperfective', 'biaspectual');--> statement-breakpoint
CREATE TYPE "public"."content_source" AS ENUM('seed', 'ai', 'teacher');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."exercise_type" AS ENUM('recognition', 'production', 'listening', 'speaking', 'cloze', 'dictation');--> statement-breakpoint
CREATE TYPE "public"."fsrs_state" AS ENUM('new', 'learning', 'review', 'relearning');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('m', 'f', 'n');--> statement-breakpoint
CREATE TYPE "public"."grammatical_case" AS ENUM('nominative', 'accusative', 'locative', 'genitive', 'dative', 'instrumental');--> statement-breakpoint
CREATE TYPE "public"."grammatical_number" AS ENUM('singular', 'dual', 'plural');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('tts', 'human_recording');--> statement-breakpoint
CREATE TYPE "public"."part_of_speech" AS ENUM('noun', 'verb', 'adjective', 'adverb', 'pronoun', 'numeral', 'preposition', 'conjunction', 'particle', 'interjection', 'phrase', 'other');--> statement-breakpoint
CREATE TYPE "public"."grammatical_person" AS ENUM('first', 'second', 'third');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('open', 'answered');--> statement-breakpoint
CREATE TYPE "public"."rating" AS ENUM('again', 'hard', 'good', 'easy');--> statement-breakpoint
CREATE TYPE "public"."rating_source" AS ENUM('manual', 'auto_speech', 'overridden');--> statement-breakpoint
CREATE TYPE "public"."register" AS ENUM('standard', 'colloquial', 'regional', 'formal');--> statement-breakpoint
CREATE TYPE "public"."speech_band" AS ENUM('good', 'close', 'off');--> statement-breakpoint
CREATE TYPE "public"."speech_status" AS ENUM('pending', 'scored', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."study_session_kind" AS ENUM('review', 'lesson', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."study_session_status" AS ENUM('active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('learner', 'teacher');--> statement-breakpoint
CREATE TYPE "public"."verb_form" AS ENUM('infinitive', 'present', 'past_participle', 'imperative', 'future', 'conditional', 'supine');--> statement-breakpoint
CREATE TABLE "auth_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"public_key" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "auth_credentials_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'learner' NOT NULL,
	"password_hash" text,
	"locale" text DEFAULT 'de' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "cloze_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phrase_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"answer" text NOT NULL,
	"answer_normalized" text NOT NULL,
	"word_form_id" uuid,
	"focus_case" "grammatical_case",
	"focus_number" "grammatical_number",
	"focus_verb_form" "verb_form",
	"hint_de" text,
	"source" "content_source" DEFAULT 'seed' NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloze_items_unique" UNIQUE("phrase_id","position")
);
--> statement-breakpoint
CREATE TABLE "grammar_note_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"lexeme_id" uuid,
	"phrase_id" uuid,
	"lesson_id" uuid
);
--> statement-breakpoint
CREATE TABLE "grammar_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title_de" text NOT NULL,
	"body_de" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" "content_source" DEFAULT 'seed' NOT NULL,
	"status" "content_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grammar_notes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "lesson_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"lexeme_id" uuid,
	"phrase_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"teaching_note_de" text
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid,
	"slug" text NOT NULL,
	"title_de" text NOT NULL,
	"intro_de" text,
	"goal_de" text,
	"position" integer DEFAULT 0 NOT NULL,
	"estimated_minutes" integer DEFAULT 4 NOT NULL,
	"source" "content_source" DEFAULT 'seed' NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "lexemes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slovene" text NOT NULL,
	"slovene_normalized" text NOT NULL,
	"german" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"part_of_speech" "part_of_speech" DEFAULT 'other' NOT NULL,
	"gender" "gender",
	"aspect" "aspect",
	"aspect_partner_id" uuid,
	"register" "register" DEFAULT 'standard' NOT NULL,
	"region_label" text,
	"difficulty" integer DEFAULT 2 NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"frequency_rank" integer,
	"source" "content_source" DEFAULT 'teacher' NOT NULL,
	"created_by" uuid,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "media_kind" NOT NULL,
	"lexeme_id" uuid,
	"phrase_id" uuid,
	"speaker_label" text,
	"path" text NOT NULL,
	"mime_type" text NOT NULL,
	"fallback_path" text,
	"duration_ms" integer,
	"byte_size" integer,
	"content_hash" text,
	"voice" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phrase_lexemes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phrase_id" uuid NOT NULL,
	"lexeme_id" uuid NOT NULL,
	"word_form_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "phrase_lexemes_unique" UNIQUE("phrase_id","lexeme_id","position")
);
--> statement-breakpoint
CREATE TABLE "phrases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slovene" text NOT NULL,
	"slovene_normalized" text NOT NULL,
	"german" text NOT NULL,
	"context_note" text,
	"register" "register" DEFAULT 'standard' NOT NULL,
	"region_label" text,
	"difficulty" integer DEFAULT 2 NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"source" "content_source" DEFAULT 'teacher' NOT NULL,
	"created_by" uuid,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title_de" text NOT NULL,
	"description_de" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "word_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lexeme_id" uuid NOT NULL,
	"form" text NOT NULL,
	"form_normalized" text NOT NULL,
	"grammatical_case" "grammatical_case",
	"number" "grammatical_number",
	"gender" "gender",
	"person" "grammatical_person",
	"verb_form" "verb_form",
	"degree" text,
	"definiteness" text,
	"msd" text,
	"is_canonical" boolean DEFAULT false NOT NULL,
	"source" "content_source" DEFAULT 'seed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lexeme_id" uuid,
	"phrase_id" uuid,
	"cloze_item_id" uuid,
	"exercise_type" "exercise_type" NOT NULL,
	"introduced_by_lesson_id" uuid,
	"introduced_at" timestamp with time zone,
	"due" timestamp with time zone DEFAULT now() NOT NULL,
	"stability" double precision DEFAULT 0 NOT NULL,
	"difficulty" double precision DEFAULT 0 NOT NULL,
	"elapsed_days" double precision DEFAULT 0 NOT NULL,
	"scheduled_days" double precision DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"state" "fsrs_state" DEFAULT 'new' NOT NULL,
	"last_review" timestamp with time zone,
	"learning_steps" integer DEFAULT 0 NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cards_unique_lexeme" UNIQUE("user_id","lexeme_id","exercise_type"),
	CONSTRAINT "cards_unique_phrase" UNIQUE("user_id","phrase_id","exercise_type"),
	CONSTRAINT "cards_unique_cloze" UNIQUE("user_id","cloze_item_id","exercise_type")
);
--> statement-breakpoint
CREATE TABLE "fsrs_optimization_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"review_count" integer NOT NULL,
	"parameters" jsonb NOT NULL,
	"log_loss" double precision,
	"rmse" double precision,
	"applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid,
	"rating" "rating" NOT NULL,
	"rating_source" "rating_source" DEFAULT 'manual' NOT NULL,
	"state" "fsrs_state" NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"stability" double precision NOT NULL,
	"difficulty" double precision NOT NULL,
	"elapsed_days" double precision NOT NULL,
	"last_elapsed_days" double precision NOT NULL,
	"scheduled_days" double precision NOT NULL,
	"learning_steps" integer DEFAULT 0 NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"state_after" jsonb,
	"duration_ms" integer,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "speech_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid,
	"target_text" text NOT NULL,
	"audio_path" text NOT NULL,
	"mime_type" text,
	"duration_ms" integer,
	"transcript" text,
	"char_similarity" real,
	"word_similarity" real,
	"band" "speech_band",
	"suggested_rating" "rating",
	"status" "speech_status" DEFAULT 'pending' NOT NULL,
	"engine" text,
	"engine_model" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scored_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "study_session_kind" DEFAULT 'review' NOT NULL,
	"status" "study_session_status" DEFAULT 'active' NOT NULL,
	"lesson_id" uuid,
	"queue" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"config" jsonb,
	"answered_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"review_cap" integer DEFAULT 20 NOT NULL,
	"daily_new_limit" integer DEFAULT 8 NOT NULL,
	"new_material_backlog_threshold" integer DEFAULT 60 NOT NULL,
	"exercise_mix" jsonb DEFAULT '{"speaking":3,"listening":3,"recognition":2,"production":2,"cloze":1,"dictation":1}'::jsonb NOT NULL,
	"autoplay_audio" boolean DEFAULT true NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"topic" text NOT NULL,
	"instructions" text,
	"model" text NOT NULL,
	"raw_response" jsonb,
	"lexeme_count" integer DEFAULT 0 NOT NULL,
	"phrase_count" integer DEFAULT 0 NOT NULL,
	"cloze_count" integer DEFAULT 0 NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_user_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"emailed_at" timestamp with time zone,
	CONSTRAINT "digest_snapshots_period_unique" UNIQUE("subject_user_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "lesson_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "lesson_progress_unique" UNIQUE("user_id","lesson_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asked_by" uuid NOT NULL,
	"card_id" uuid,
	"lexeme_id" uuid,
	"phrase_id" uuid,
	"body" text,
	"status" "question_status" DEFAULT 'open' NOT NULL,
	"answer_text" text,
	"answer_media_id" uuid,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_credentials" ADD CONSTRAINT "auth_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloze_items" ADD CONSTRAINT "cloze_items_phrase_id_phrases_id_fk" FOREIGN KEY ("phrase_id") REFERENCES "public"."phrases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloze_items" ADD CONSTRAINT "cloze_items_word_form_id_word_forms_id_fk" FOREIGN KEY ("word_form_id") REFERENCES "public"."word_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grammar_note_links" ADD CONSTRAINT "grammar_note_links_note_id_grammar_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."grammar_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grammar_note_links" ADD CONSTRAINT "grammar_note_links_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grammar_note_links" ADD CONSTRAINT "grammar_note_links_phrase_id_phrases_id_fk" FOREIGN KEY ("phrase_id") REFERENCES "public"."phrases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grammar_note_links" ADD CONSTRAINT "grammar_note_links_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_items" ADD CONSTRAINT "lesson_items_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_items" ADD CONSTRAINT "lesson_items_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_items" ADD CONSTRAINT "lesson_items_phrase_id_phrases_id_fk" FOREIGN KEY ("phrase_id") REFERENCES "public"."phrases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexemes" ADD CONSTRAINT "lexemes_aspect_partner_id_lexemes_id_fk" FOREIGN KEY ("aspect_partner_id") REFERENCES "public"."lexemes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexemes" ADD CONSTRAINT "lexemes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_phrase_id_phrases_id_fk" FOREIGN KEY ("phrase_id") REFERENCES "public"."phrases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phrase_lexemes" ADD CONSTRAINT "phrase_lexemes_phrase_id_phrases_id_fk" FOREIGN KEY ("phrase_id") REFERENCES "public"."phrases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phrase_lexemes" ADD CONSTRAINT "phrase_lexemes_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phrase_lexemes" ADD CONSTRAINT "phrase_lexemes_word_form_id_word_forms_id_fk" FOREIGN KEY ("word_form_id") REFERENCES "public"."word_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phrases" ADD CONSTRAINT "phrases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_forms" ADD CONSTRAINT "word_forms_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_phrase_id_phrases_id_fk" FOREIGN KEY ("phrase_id") REFERENCES "public"."phrases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_cloze_item_id_cloze_items_id_fk" FOREIGN KEY ("cloze_item_id") REFERENCES "public"."cloze_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_introduced_by_lesson_id_lessons_id_fk" FOREIGN KEY ("introduced_by_lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fsrs_optimization_runs" ADD CONSTRAINT "fsrs_optimization_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speech_attempts" ADD CONSTRAINT "speech_attempts_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speech_attempts" ADD CONSTRAINT "speech_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_snapshots" ADD CONSTRAINT "digest_snapshots_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_asked_by_users_id_fk" FOREIGN KEY ("asked_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_phrase_id_phrases_id_fk" FOREIGN KEY ("phrase_id") REFERENCES "public"."phrases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_answer_media_id_media_assets_id_fk" FOREIGN KEY ("answer_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_credentials_user_idx" ON "auth_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "cloze_items_phrase_idx" ON "cloze_items" USING btree ("phrase_id");--> statement-breakpoint
CREATE INDEX "grammar_note_links_note_idx" ON "grammar_note_links" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "grammar_note_links_lexeme_idx" ON "grammar_note_links" USING btree ("lexeme_id");--> statement-breakpoint
CREATE INDEX "grammar_note_links_phrase_idx" ON "grammar_note_links" USING btree ("phrase_id");--> statement-breakpoint
CREATE INDEX "grammar_note_links_lesson_idx" ON "grammar_note_links" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "lesson_items_lesson_idx" ON "lesson_items" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "lessons_unit_idx" ON "lessons" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "lessons_position_idx" ON "lessons" USING btree ("position");--> statement-breakpoint
CREATE INDEX "lexemes_normalized_idx" ON "lexemes" USING btree ("slovene_normalized");--> statement-breakpoint
CREATE INDEX "lexemes_status_idx" ON "lexemes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lexemes_pos_idx" ON "lexemes" USING btree ("part_of_speech");--> statement-breakpoint
CREATE INDEX "lexemes_frequency_idx" ON "lexemes" USING btree ("frequency_rank");--> statement-breakpoint
CREATE INDEX "media_assets_lexeme_idx" ON "media_assets" USING btree ("lexeme_id");--> statement-breakpoint
CREATE INDEX "media_assets_phrase_idx" ON "media_assets" USING btree ("phrase_id");--> statement-breakpoint
CREATE INDEX "media_assets_hash_idx" ON "media_assets" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "phrase_lexemes_phrase_idx" ON "phrase_lexemes" USING btree ("phrase_id");--> statement-breakpoint
CREATE INDEX "phrase_lexemes_lexeme_idx" ON "phrase_lexemes" USING btree ("lexeme_id");--> statement-breakpoint
CREATE INDEX "phrases_normalized_idx" ON "phrases" USING btree ("slovene_normalized");--> statement-breakpoint
CREATE INDEX "phrases_status_idx" ON "phrases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "word_forms_lexeme_idx" ON "word_forms" USING btree ("lexeme_id");--> statement-breakpoint
CREATE INDEX "word_forms_normalized_idx" ON "word_forms" USING btree ("form_normalized");--> statement-breakpoint
CREATE INDEX "word_forms_features_idx" ON "word_forms" USING btree ("lexeme_id","grammatical_case","number");--> statement-breakpoint
CREATE INDEX "cards_user_due_idx" ON "cards" USING btree ("user_id","due");--> statement-breakpoint
CREATE INDEX "cards_user_state_idx" ON "cards" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "cards_lexeme_idx" ON "cards" USING btree ("lexeme_id");--> statement-breakpoint
CREATE INDEX "cards_phrase_idx" ON "cards" USING btree ("phrase_id");--> statement-breakpoint
CREATE INDEX "cards_cloze_idx" ON "cards" USING btree ("cloze_item_id");--> statement-breakpoint
CREATE INDEX "review_logs_card_idx" ON "review_logs" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "review_logs_user_time_idx" ON "review_logs" USING btree ("user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "speech_attempts_user_time_idx" ON "speech_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "speech_attempts_card_idx" ON "speech_attempts" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "speech_attempts_status_idx" ON "speech_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "study_sessions_user_status_idx" ON "study_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "study_sessions_user_time_idx" ON "study_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "ai_generation_runs_user_idx" ON "ai_generation_runs" USING btree ("requested_by","created_at");--> statement-breakpoint
CREATE INDEX "digest_snapshots_generated_idx" ON "digest_snapshots" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "lesson_progress_user_idx" ON "lesson_progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "questions_status_idx" ON "questions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "questions_asked_by_idx" ON "questions" USING btree ("asked_by");--> statement-breakpoint
CREATE INDEX "questions_lexeme_idx" ON "questions" USING btree ("lexeme_id");--> statement-breakpoint
CREATE INDEX "questions_phrase_idx" ON "questions" USING btree ("phrase_id");