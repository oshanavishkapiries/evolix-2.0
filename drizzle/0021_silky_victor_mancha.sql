CREATE TABLE "app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "config_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"scope" text DEFAULT 'app' NOT NULL,
	"old_value" text,
	"new_value" text,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	CONSTRAINT "config_audit_action_check" CHECK ("config_audit"."action" in ('set', 'reset', 'rollback')),
	CONSTRAINT "config_audit_scope_check" CHECK ("config_audit"."scope" = 'app' or "config_audit"."scope" like 'engine:%')
);
--> statement-breakpoint
CREATE INDEX "config_audit_key_at_idx" ON "config_audit" USING btree ("scope","key","at");