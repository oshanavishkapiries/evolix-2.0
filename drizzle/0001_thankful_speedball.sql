CREATE TYPE "public"."source_kind" AS ENUM('direct', 'hls', 'embed');--> statement-breakpoint
CREATE TYPE "public"."subtitle_format" AS ENUM('vtt', 'srt');--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"tmdb_id" integer,
	"episode_number" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"overview" text DEFAULT '' NOT NULL,
	"air_date" date,
	"runtime_minutes" integer,
	"still_path" text,
	"is_visible" boolean DEFAULT true NOT NULL,
	CONSTRAINT "episodes_season_number_uq" UNIQUE("season_id","episode_number")
);
--> statement-breakpoint
CREATE TABLE "movies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tmdb_id" integer NOT NULL,
	"title" text NOT NULL,
	"original_title" text DEFAULT '' NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"overview" text DEFAULT '' NOT NULL,
	"release_date" date,
	"runtime_minutes" integer,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"rating" real,
	"vote_count" integer,
	"original_language" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"poster_path" text,
	"backdrop_path" text,
	"cast" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movies_tmdb_id_unique" UNIQUE("tmdb_id")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"tmdb_id" integer,
	"season_number" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"overview" text DEFAULT '' NOT NULL,
	"air_date" date,
	"poster_path" text,
	"is_visible" boolean DEFAULT true NOT NULL,
	CONSTRAINT "seasons_show_number_uq" UNIQUE("show_id","season_number")
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tmdb_id" integer NOT NULL,
	"name" text NOT NULL,
	"original_name" text DEFAULT '' NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"overview" text DEFAULT '' NOT NULL,
	"first_air_date" date,
	"last_air_date" date,
	"status" text DEFAULT '' NOT NULL,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"rating" real,
	"vote_count" integer,
	"original_language" text DEFAULT '' NOT NULL,
	"poster_path" text,
	"backdrop_path" text,
	"cast" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shows_tmdb_id_unique" UNIQUE("tmdb_id")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movie_id" uuid,
	"episode_id" uuid,
	"label" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"url" text NOT NULL,
	"quality" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_one_parent_chk" CHECK (("sources"."movie_id" is null) <> ("sources"."episode_id" is null))
);
--> statement-breakpoint
CREATE TABLE "subtitles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movie_id" uuid,
	"episode_id" uuid,
	"label" text NOT NULL,
	"language" text NOT NULL,
	"url" text NOT NULL,
	"format" "subtitle_format" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subtitles_one_parent_chk" CHECK (("subtitles"."movie_id" is null) <> ("subtitles"."episode_id" is null))
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_movie_id_movies_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitles" ADD CONSTRAINT "subtitles_movie_id_movies_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtitles" ADD CONSTRAINT "subtitles_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episodes_season_id_idx" ON "episodes" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "seasons_show_id_idx" ON "seasons" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "sources_movie_id_idx" ON "sources" USING btree ("movie_id");--> statement-breakpoint
CREATE INDEX "sources_episode_id_idx" ON "sources" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "subtitles_movie_id_idx" ON "subtitles" USING btree ("movie_id");--> statement-breakpoint
CREATE INDEX "subtitles_episode_id_idx" ON "subtitles" USING btree ("episode_id");