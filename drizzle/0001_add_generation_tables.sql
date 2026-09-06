CREATE TYPE "public"."generation_decision" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."generation_kind" AS ENUM('mixed', 'phrases', 'lexemes', 'cloze');--> statement-breakpoint
CREATE TYPE "public"."generation_run_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "generation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"phrase_id" uuid,
	"lexeme_id" uuid,
	"cloze_item_id" uuid,
	"duplicate_of_phrase_id" uuid,
	"duplicate_of_lexeme_id" uuid,
	"decision" "generation_decision" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid,
	"topic" text NOT NULL,
	"instructions" text,
	"kind" "generation_kind" DEFAULT 'mixed' NOT NULL,
	"requested_count" integer DEFAULT 8 NOT NULL,
	"model" text NOT NULL,
	"status" "generation_run_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"model_notes" text,
	"proposed_count" integer DEFAULT 0 NOT NULL,
	"drafted_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "generation_items" ADD CONSTRAINT "generation_items_run_id_generation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."generation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_items" ADD CONSTRAINT "generation_items_phrase_id_phrases_id_fk" FOREIGN KEY ("phrase_id") REFERENCES "public"."phrases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_items" ADD CONSTRAINT "generation_items_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_items" ADD CONSTRAINT "generation_items_cloze_item_id_cloze_items_id_fk" FOREIGN KEY ("cloze_item_id") REFERENCES "public"."cloze_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_items" ADD CONSTRAINT "generation_items_duplicate_of_phrase_id_phrases_id_fk" FOREIGN KEY ("duplicate_of_phrase_id") REFERENCES "public"."phrases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_items" ADD CONSTRAINT "generation_items_duplicate_of_lexeme_id_lexemes_id_fk" FOREIGN KEY ("duplicate_of_lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_items" ADD CONSTRAINT "generation_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_items_run_idx" ON "generation_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "generation_items_decision_idx" ON "generation_items" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "generation_runs_created_idx" ON "generation_runs" USING btree ("created_at");