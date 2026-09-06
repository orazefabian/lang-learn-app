ALTER TABLE "review_logs" ADD COLUMN "client_event_id" text;--> statement-breakpoint
ALTER TABLE "speech_attempts" ADD COLUMN "client_event_id" text;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_client_event_unique" UNIQUE("client_event_id");--> statement-breakpoint
ALTER TABLE "speech_attempts" ADD CONSTRAINT "speech_attempts_client_event_unique" UNIQUE("client_event_id");