CREATE TABLE "evo_claims" (
	"key" text PRIMARY KEY NOT NULL,
	"engine_id" text NOT NULL,
	"task_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evo_engines" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"draining" boolean DEFAULT false NOT NULL,
	"healthy" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"active_jobs" integer DEFAULT 0 NOT NULL,
	"queue_depth" integer DEFAULT 0 NOT NULL,
	"max_extractions" integer DEFAULT 1 NOT NULL,
	"free_disk_gb" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evo_subtitle_owners" (
	"sub_id" text PRIMARY KEY NOT NULL,
	"engine_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evo_tasks" (
	"task_id" text PRIMARY KEY NOT NULL,
	"engine_id" text NOT NULL,
	"kind" text NOT NULL,
	"claim_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "engine_id" text;--> statement-breakpoint
ALTER TABLE "subtitles" ADD COLUMN "engine_id" text;--> statement-breakpoint
CREATE INDEX "evo_tasks_engine_idx" ON "evo_tasks" USING btree ("engine_id","created_at");