CREATE TYPE "public"."subtitle_source" AS ENUM('auto', 'opensubtitles', 'upload', 'translation');--> statement-breakpoint
CREATE TYPE "public"."subtitle_visibility" AS ENUM('private', 'shared');--> statement-breakpoint
CREATE TABLE "subtitle_activity" (
	"track_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"played_at" timestamp with time zone,
	"good" boolean DEFAULT false NOT NULL,
	"problem" text,
	CONSTRAINT "subtitle_activity_track_id_user_id_pk" PRIMARY KEY("track_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "subtitle_grants" (
	"track_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "subtitle_grants_track_id_user_id_pk" PRIMARY KEY("track_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "subtitle_plays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"track_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subtitle_quota" (
	"user_id" uuid NOT NULL,
	"media_key" text NOT NULL,
	"kind" text NOT NULL,
	"day" date DEFAULT current_date NOT NULL,
	"used" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "subtitle_quota_user_id_media_key_kind_day_pk" PRIMARY KEY("user_id","media_key","kind","day")
);
--> statement-breakpoint
ALTER TABLE "subtitles" DROP CONSTRAINT "subtitles_movie_language_uq";--> statement-breakpoint
ALTER TABLE "subtitles" DROP CONSTRAINT "subtitles_episode_language_uq";--> statement-breakpoint
ALTER TABLE "subtitles" ADD COLUMN "source" "subtitle_source" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "subtitles" ADD COLUMN "origin_ref" text;--> statement-breakpoint
ALTER TABLE "subtitles" ADD COLUMN "origin_key" text GENERATED ALWAYS AS (coalesce(origin_ref, '')) STORED;--> statement-breakpoint
ALTER TABLE "subtitles" ADD COLUMN "origin_track_id" uuid;--> statement-breakpoint
ALTER TABLE "subtitles" ADD COLUMN "uploaded_by" uuid;--> statement-breakpoint
ALTER TABLE "subtitles" ADD COLUMN "visibility" "subtitle_visibility" DEFAULT 'shared' NOT NULL;--> statement-breakpoint
ALTER TABLE "subtitles" ADD COLUMN "score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subtitles" ADD COLUMN "plays_ok" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subtitles" ADD COLUMN "reports" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subtitles" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subtitles" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subtitle_activity" ADD CONSTRAINT "subtitle_activity_track_id_subtitles_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."subtitles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_activity" ADD CONSTRAINT "subtitle_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_grants" ADD CONSTRAINT "subtitle_grants_track_id_subtitles_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."subtitles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_grants" ADD CONSTRAINT "subtitle_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_plays" ADD CONSTRAINT "subtitle_plays_track_id_subtitles_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."subtitles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_plays" ADD CONSTRAINT "subtitle_plays_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitle_quota" ADD CONSTRAINT "subtitle_quota_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subtitle_plays_track_user_idx" ON "subtitle_plays" USING btree ("track_id","user_id");--> statement-breakpoint
ALTER TABLE "subtitles" ADD CONSTRAINT "subtitles_origin_track_id_subtitles_id_fk" FOREIGN KEY ("origin_track_id") REFERENCES "public"."subtitles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitles" ADD CONSTRAINT "subtitles_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subtitles_movie_origin_uq" ON "subtitles" USING btree ("movie_id","language","source","origin_key") WHERE "subtitles"."movie_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "subtitles_episode_origin_uq" ON "subtitles" USING btree ("episode_id","language","source","origin_key") WHERE "subtitles"."episode_id" is not null;
