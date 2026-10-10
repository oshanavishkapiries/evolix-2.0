CREATE TYPE "public"."video_site" AS ENUM('youtube', 'vimeo');--> statement-breakpoint
CREATE TYPE "public"."video_type" AS ENUM('trailer', 'teaser', 'clip', 'featurette', 'behind_the_scenes', 'bloopers', 'opening_credits', 'other');--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movie_id" uuid,
	"show_id" uuid,
	"site" "video_site" NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" "video_type" NOT NULL,
	"official" boolean DEFAULT false NOT NULL,
	"language" text,
	"published_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "videos_one_parent_chk" CHECK (("videos"."movie_id" is null) <> ("videos"."show_id" is null))
);
--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_movie_id_movies_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "videos_movie_id_idx" ON "videos" USING btree ("movie_id");--> statement-breakpoint
CREATE INDEX "videos_show_id_idx" ON "videos" USING btree ("show_id");--> statement-breakpoint
CREATE UNIQUE INDEX "videos_movie_site_key_uq" ON "videos" USING btree ("movie_id","site","key") WHERE "videos"."movie_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "videos_show_site_key_uq" ON "videos" USING btree ("show_id","site","key") WHERE "videos"."show_id" is not null;