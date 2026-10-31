CREATE TABLE "support_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_conversations_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "support_status_check" CHECK ("support_conversations"."status" in ('open', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"sender_role" text NOT NULL,
	"client_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_message_retry_uq" UNIQUE("conversation_id","sender_id","client_id"),
	CONSTRAINT "support_sender_role_check" CHECK ("support_messages"."sender_role" in ('user', 'admin')),
	CONSTRAINT "support_text_check" CHECK (length(trim("support_messages"."text")) between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "support_read_states" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_message_id" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "support_read_states_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."support_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_read_states" ADD CONSTRAINT "support_read_states_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."support_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_read_states" ADD CONSTRAINT "support_read_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_updated_idx" ON "support_conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "support_messages_thread_idx" ON "support_messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "support_messages_sender_idx" ON "support_messages" USING btree ("sender_id","created_at");