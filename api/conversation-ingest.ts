import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

import type { Database } from "./db/index.js";
import { conversations, messages, usageTurns } from "./db/schema.js";
import type { ConversationMessage } from "./storage.js";

export interface IngestConversation {
  claudeSessionId: string;
  projectPath: string;
  origin: string;
  displayText: string | null;
}

export interface IngestMessage {
  claudeMessageId: string;
  role: string;
  content: unknown;
  usage: unknown;
  createdAt?: Date;
  parentClaudeMessageId: string | null;
}

export interface IngestRecords {
  conversation: IngestConversation;
  messages: IngestMessage[];
}

export interface UsageTurn {
  claudeMessageId: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number | null;
}

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
}

export function estimateUsageCost(
  usage: Pick<UsageTurn, "inputTokens" | "outputTokens" | "cacheReadTokens">,
  price: ModelPrice | null,
): number | null {
  if (!price) return null;
  return (
    (usage.inputTokens * price.inputPerMillion +
      usage.outputTokens * price.outputPerMillion +
      usage.cacheReadTokens * price.cacheReadPerMillion) /
    1_000_000
  );
}

export function extractUsageTurn(record: ConversationMessage): UsageTurn | null {
  if (record.type !== "assistant" || !record.uuid || !record.message?.usage) return null;
  const usage = record.message.usage;
  return {
    claudeMessageId: record.uuid,
    model: record.message.model ?? null,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    costUsd: null,
  };
}

export function parseJsonlLines(content: string): ConversationMessage[] {
  const records: ConversationMessage[] = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as ConversationMessage;
      if (
        (record.type === "user" || record.type === "assistant") &&
        typeof record.uuid === "string"
      ) {
        records.push(record);
      }
    } catch {
      // Ignore malformed and incomplete lines; the next file change will retry them.
    }
  }

  return records;
}

export function buildIngestRecords(
  records: ConversationMessage[],
  filePath: string,
): IngestRecords {
  const first = records[0];
  const sessionId = records.find((record) => record.sessionId)?.sessionId ?? basename(filePath, ".jsonl");
  const messages = new Map<string, IngestMessage>();

  for (const record of records) {
    if (!record.uuid || !record.message) continue;
    if (messages.has(record.uuid)) continue;

    messages.set(record.uuid, {
      claudeMessageId: record.uuid,
      role: record.message.role,
      content: record.message.content,
      usage: record.message.usage ?? null,
      createdAt: record.timestamp ? new Date(record.timestamp) : undefined,
      parentClaudeMessageId: record.parentUuid ?? null,
    });
  }

  return {
    conversation: {
      claudeSessionId: sessionId,
      projectPath: dirname(filePath),
      origin: "jsonl",
      displayText: typeof first?.message?.content === "string" ? first.message.content : null,
    },
    messages: [...messages.values()],
  };
}

export function getIngestSingletonKey(filePath: string): string {
  return filePath;
}

export async function ingestJsonlFile(
  db: Database,
  filePath: string,
  projectPath?: string,
): Promise<void> {
  const content = await readFile(filePath, "utf8");
  const records = buildIngestRecords(parseJsonlLines(content), filePath);
  if (records.messages.length === 0) return;

  const conversation = await db
    .insert(conversations)
    .values({
      ...records.conversation,
      projectPath: projectPath ?? records.conversation.projectPath,
    })
    .onConflictDoUpdate({
      target: conversations.claudeSessionId,
      set: {
        projectPath: projectPath ?? records.conversation.projectPath,
        lastSeenAt: new Date(),
      },
    })
    .returning({ id: conversations.id });

  const conversationId = conversation[0]?.id;
  if (!conversationId) throw new Error(`Unable to upsert conversation: ${records.conversation.claudeSessionId}`);

  for (const message of records.messages) {
    await db
      .insert(messages)
      .values({ ...message, conversationId })
      .onConflictDoUpdate({
        target: messages.claudeMessageId,
        set: {
          conversationId,
          role: message.role,
          content: message.content,
          usage: message.usage,
          parentClaudeMessageId: message.parentClaudeMessageId,
        },
      });
  }

  for (const record of parseJsonlLines(content)) {
    const turn = extractUsageTurn(record);
    if (!turn) continue;
    await db
      .insert(usageTurns)
      .values({
        conversationId,
        claudeMessageId: turn.claudeMessageId,
        model: turn.model,
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        cacheReadTokens: turn.cacheReadTokens,
        costUsd: turn.costUsd === null ? null : String(turn.costUsd),
      })
      .onConflictDoUpdate({
        target: usageTurns.claudeMessageId,
        set: {
          conversationId,
          model: turn.model,
          inputTokens: turn.inputTokens,
          outputTokens: turn.outputTokens,
          cacheReadTokens: turn.cacheReadTokens,
          costUsd: turn.costUsd === null ? null : String(turn.costUsd),
        },
      });
  }
}
