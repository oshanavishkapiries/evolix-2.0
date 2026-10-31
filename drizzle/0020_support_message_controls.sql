ALTER TABLE "support_conversations" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_read_states" ADD COLUMN "cleared_through_id" bigint DEFAULT 0 NOT NULL;