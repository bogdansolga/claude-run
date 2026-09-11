import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateUsageCost,
  extractUsageTurn,
} from "../api/conversation-ingest.js";

test("extracts assistant usage into a cost turn without inventing unknown prices", () => {
  const turn = extractUsageTurn({
    uuid: "assistant-1",
    sessionId: "session-1",
    type: "assistant",
    timestamp: "2026-09-10T00:00:01.000Z",
    message: {
      role: "assistant",
      content: "done",
      model: "claude-test",
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cache_read_input_tokens: 250_000,
      },
    },
  });

  assert.deepEqual(turn, {
    claudeMessageId: "assistant-1",
    model: "claude-test",
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    cacheReadTokens: 250_000,
    costUsd: null,
  });
});

test("estimates cost from an explicit model price", () => {
  assert.equal(
    estimateUsageCost(
      { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 250_000 },
      { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3 },
    ),
    10.575,
  );
});
