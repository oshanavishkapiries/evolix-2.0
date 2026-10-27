CREATE TABLE "player_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"movie_id" uuid,
	"episode_id" uuid,
	"media_key" text NOT NULL,
	"title" text NOT NULL,
	"rating" integer NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"position_seconds" integer,
	"duration_seconds" integer,
	"quality" text,
	"stalls" integer,
	"trigger" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_feedback_rating_chk" CHECK ("player_feedback"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "player_feedback" ADD CONSTRAINT "player_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_feedback" ADD CONSTRAINT "player_feedback_movie_id_movies_id_fk" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_feedback" ADD CONSTRAINT "player_feedback_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_feedback_created_idx" ON "player_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "player_feedback_user_created_idx" ON "player_feedback" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "player_feedback_media_idx" ON "player_feedback" USING btree ("media_key");