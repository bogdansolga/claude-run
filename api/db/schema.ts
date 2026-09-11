import { relations } from "drizzle-orm";
import {
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const claudeRunSchema = pgSchema("claude_run");

export const conversations = claudeRunSchema.table("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  claudeSessionId: text("claude_session_id").notNull().unique(),
  projectPath: text("project_path").notNull(),
  origin: text("origin").notNull().default("jsonl"),
  displayText: text("display_text"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = claudeRunSchema.table("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  claudeMessageId: text("claude_message_id").notNull().unique(),
  role: text("role").notNull(),
  content: jsonb("content").notNull(),
  usage: jsonb("usage"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  parentClaudeMessageId: text("parent_claude_message_id"),
});

export const usageTurns = claudeRunSchema.table("usage_turns", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  claudeMessageId: text("claude_message_id").notNull().unique(),
  model: text("model"),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 18, scale: 8 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
  usageTurns: many(usageTurns),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const usageTurnsRelations = relations(usageTurns, ({ one }) => ({
  conversation: one(conversations, {
    fields: [usageTurns.conversationId],
    references: [conversations.id],
  }),
}));

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type UsageTurn = typeof usageTurns.$inferSelect;
export type NewUsageTurn = typeof usageTurns.$inferInsert;

export const schema = { conversations, messages, usageTurns };
