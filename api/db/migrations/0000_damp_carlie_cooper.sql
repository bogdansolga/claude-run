CREATE SCHEMA "claude_run";
--> statement-breakpoint
CREATE TABLE "claude_run"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claude_session_id" text NOT NULL,
	"project_path" text NOT NULL,
	"origin" text DEFAULT 'jsonl' NOT NULL,
	"display_text" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_claude_session_id_unique" UNIQUE("claude_session_id")
);
--> statement-breakpoint
CREATE TABLE "claude_run"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"claude_message_id" text NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parent_claude_message_id" text,
	CONSTRAINT "messages_claude_message_id_unique" UNIQUE("claude_message_id")
);
--> statement-breakpoint
ALTER TABLE "claude_run"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "claude_run"."conversations"("id") ON DELETE cascade ON UPDATE no action;