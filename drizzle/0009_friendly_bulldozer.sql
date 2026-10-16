ALTER TABLE "users" ADD COLUMN "approved_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "users" SET "approved_at" = now() WHERE "approved_at" IS NULL;
