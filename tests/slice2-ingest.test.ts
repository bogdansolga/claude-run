import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIngestRecords,
  getIngestSingletonKey,
  parseJsonlLines,
} from "../api/conversation-ingest.js";

test("parses complete JSONL records and ignores malformed lines", () => {
  const records = parseJsonlLines(
    [
      JSON.stringify({ type: "user", uuid: "u-1", sessionId: "s-1", message: { role: "user", content: "hello" } }),
      "not json",
      JSON.stringify({ type: "assistant", uuid: "a-1", sessionId: "s-1", message: { role: "assistant", content: "world", model: "claude-test", usage: { input_tokens: 3, output_tokens: 2 } } }),
      "{\"type\":\"assistant\"",
    ].join("\n"),
  );

  assert.equal(records.length, 2);
  assert.equal(records[0]?.uuid, "u-1");
  assert.equal(records[1]?.message?.role, "assistant");
});

test("normalizes a JSONL file into one conversation and message per UUID", () => {
  const records = parseJsonlLines(
    [
      JSON.stringify({
        type: "user",
        uuid: "u-1",
        sessionId: "s-1",
        timestamp: "2026-09-10T00:00:00.000Z",
        message: { role: "user", content: "hello" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "a-1",
        sessionId: "s-1",
        parentUuid: "u-1",
        timestamp: "2026-09-10T00:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "world" }],
          model: "claude-test",
          usage: { input_tokens: 3, output_tokens: 2 },
        },
      }),
    ].join("\n"),
  );

  const result = buildIngestRecords(records, "/work/project/session.jsonl");
  assert.equal(result.conversation.claudeSessionId, "s-1");
  assert.equal(result.conversation.projectPath, "/work/project");
  assert.equal(result.messages.length, 2);
  assert.deepEqual(result.messages[1]?.usage, { input_tokens: 3, output_tokens: 2 });
  assert.equal(result.messages[1]?.parentClaudeMessageId, "u-1");
});

test("uses the absolute JSONL path as the ingest singleton key", () => {
  assert.equal(getIngestSingletonKey("/tmp/project/session.jsonl"), "/tmp/project/session.jsonl");
});
