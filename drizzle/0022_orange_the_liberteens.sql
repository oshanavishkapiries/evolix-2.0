ALTER TABLE "evo_engines" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "evo_engines" ADD COLUMN "token" text;--> statement-breakpoint
ALTER TABLE "evo_engines" ADD COLUMN "managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "evo_engines" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evo_engines" ADD COLUMN "config_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "evo_engines" ADD COLUMN "config_pushed_version" integer DEFAULT 0 NOT NULL;