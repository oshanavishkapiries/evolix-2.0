ALTER TABLE "movies" ADD COLUMN "logo_path" text;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "gallery_backdrops" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "logo_path" text;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "gallery_backdrops" jsonb DEFAULT '[]'::jsonb NOT NULL;