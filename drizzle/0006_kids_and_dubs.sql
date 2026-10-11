CREATE TYPE "public"."audience" AS ENUM('general', 'kids', 'both');--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "audience" "audience" DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "audience" "audience" DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "audio_language" text DEFAULT '' NOT NULL;