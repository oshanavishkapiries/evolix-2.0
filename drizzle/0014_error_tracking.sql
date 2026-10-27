CREATE TYPE "public"."error_status" AS ENUM('unresolved', 'resolved', 'ignored');--> statement-breakpoint
CREATE TABLE "error_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message" text NOT NULL,
	"stack" text DEFAULT '' NOT NULL,
	"frames" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url" text,
	"method" text,
	"route" text,
	"user_id" uuid,
	"user_email" text,
	"user_agent" text,
	"release" text,
	"environment" text,
	"breadcrumbs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_issue_days" (
	"issue_id" uuid NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "error_issue_days_issue_id_day_pk" PRIMARY KEY("issue_id","day")
);
--> statement-breakpoint
CREATE TABLE "error_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"culprit" text DEFAULT '' NOT NULL,
	"level" text DEFAULT 'error' NOT NULL,
	"status" "error_status" DEFAULT 'unresolved' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"first_release" text,
	"last_release" text,
	"alerted_at" timestamp with time zone,
	CONSTRAINT "error_issues_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_issue_id_error_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."error_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_issue_days" ADD CONSTRAINT "error_issue_days_issue_id_error_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."error_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "error_events_issue_created_idx" ON "error_events" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "error_events_user_idx" ON "error_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "error_issues_status_last_idx" ON "error_issues" USING btree ("status","last_seen");