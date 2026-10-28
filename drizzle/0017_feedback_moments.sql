CREATE TABLE "feedback_asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"media_key" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"outcome" text DEFAULT 'shown' NOT NULL,
	"value" integer,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_asks_outcome_chk" CHECK ("feedback_asks"."outcome" in ('shown', 'answered', 'ignored'))
);
--> statement-breakpoint
CREATE TABLE "feedback_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"opted_out" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_questions" (
	"key" text PRIMARY KEY NOT NULL,
	"moment" text NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"sample_rate" integer DEFAULT 100 NOT NULL,
	"target" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"once" text DEFAULT 'user' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_questions_kind_chk" CHECK ("feedback_questions"."kind" in ('thumbs', 'faces')),
	CONSTRAINT "feedback_questions_once_chk" CHECK ("feedback_questions"."once" in ('user', 'title')),
	CONSTRAINT "feedback_questions_sample_chk" CHECK ("feedback_questions"."sample_rate" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "feedback_asks" ADD CONSTRAINT "feedback_asks_question_key_feedback_questions_key_fk" FOREIGN KEY ("question_key") REFERENCES "public"."feedback_questions"("key") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback_asks" ADD CONSTRAINT "feedback_asks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_prefs" ADD CONSTRAINT "feedback_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_asks_user_created_idx" ON "feedback_asks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_asks_question_idx" ON "feedback_asks" USING btree ("question_key","outcome");--> statement-breakpoint
-- The starting questions. "experience" is today's player survey (answers stay in player_feedback); the others are off
-- except "subtitle_sync" and can be switched on from Admin -> Feedback -> Questions.
INSERT INTO "feedback_questions" ("key", "moment", "kind", "prompt", "reasons", "sample_rate", "target", "priority", "once", "active") VALUES
	('experience', 'experience', 'faces', 'How''s your watching experience?', '{}', 35, NULL, 10, 'title', true),
	('subtitle_sync', 'subtitle_picked', 'thumbs', 'Is this subtitle in sync?', '{"Out of sync","Wrong language","Wrong movie","Hard to read"}', 50, 200, 20, 'user', true),
	('sinhala_rating', 'sinhala_watched', 'faces', 'How''s the Sinhala translation?', '{"Hard to understand","Wrong meaning","Out of sync","Too formal"}', 100, 100, 20, 'user', false),
	('quality_better', 'quality_switched', 'thumbs', 'Is playback better now?', '{"Still buffering","Picture got worse","Something else"}', 50, 100, 15, 'user', false),
	('busy_wait', 'busy_waited', 'thumbs', 'Was the wait OK?', '{"Too long","Not clear what was happening","Something else"}', 100, 100, 15, 'user', false)
ON CONFLICT ("key") DO NOTHING;
