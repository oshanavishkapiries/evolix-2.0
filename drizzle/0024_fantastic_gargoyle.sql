CREATE TABLE "engine_config" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "engine_config_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "engine_config_sync" (
	"engine_id" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"last_attempt_at" timestamp with time zone,
	"restart_needed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "engine_config_sync_state_check" CHECK ("engine_config_sync"."state" in ('pending','in_sync','too_old','rejected'))
);
--> statement-breakpoint
ALTER TABLE "config_audit" DROP CONSTRAINT "config_audit_scope_check";--> statement-breakpoint
ALTER TABLE "config_audit" ADD CONSTRAINT "config_audit_scope_check" CHECK ("config_audit"."scope" = 'app' or "config_audit"."scope" = 'engine-global' or "config_audit"."scope" like 'engine:%');