ALTER TABLE "sources" ADD CONSTRAINT "sources_movie_quality_uq" UNIQUE("movie_id","quality");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_episode_quality_uq" UNIQUE("episode_id","quality");--> statement-breakpoint
ALTER TABLE "subtitles" ADD CONSTRAINT "subtitles_movie_language_uq" UNIQUE("movie_id","language");--> statement-breakpoint
ALTER TABLE "subtitles" ADD CONSTRAINT "subtitles_episode_language_uq" UNIQUE("episode_id","language");