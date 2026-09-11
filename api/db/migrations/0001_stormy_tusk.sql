CREATE TABLE "claude_run"."usage_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"claude_message_id" text NOT NULL,
	"model" text,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(18, 8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_turns_claude_message_id_unique" UNIQUE("claude_message_id")
);
--> statement-breakpoint
ALTER TABLE "claude_run"."usage_turns" ADD CONSTRAINT "usage_turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "claude_run"."conversations"("id") ON DELETE cascade ON UPDATE no action;