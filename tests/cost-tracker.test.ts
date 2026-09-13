import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateSubscriptionCost,
  normalizeCostRow,
} from "../api/cost-tracker.js";

test("normalizes tracked daily and session cost totals", () => {
  assert.deepEqual(
    normalizeCostRow({
      session_id: "session-1",
      session_cost_usd: "1.25000000",
      today_cost_usd: "3.50000000",
      today_input_tokens: 100,
      today_output_tokens: 50,
      today_cache_read_tokens: 25,
      today_known_turns: 2,
      today_unknown_cost_turns: 0,
    }),
    {
      sessionId: "session-1",
      sessionCostUsd: 1.25,
      todayCostUsd: 3.5,
      todayInputTokens: 100,
      todayOutputTokens: 50,
      todayCacheReadTokens: 25,
      todayKnownTurns: 2,
      todayUnknownCostTurns: 0,
      costTracking: "tracked",
      subscriptionTier: null,
      contextUsedPercent: null,
      contextWindowTokens: null,
    },
  );
});

test("marks cost tracking unknown when any daily turn has no price", () => {
  const summary = normalizeCostRow({
    session_id: null,
    session_cost_usd: null,
    today_cost_usd: null,
    today_input_tokens: 10,
    today_output_tokens: 5,
    today_cache_read_tokens: 0,
    today_known_turns: 0,
    today_unknown_cost_turns: 1,
  });

  assert.equal(summary.costTracking, "unknown");
  assert.equal(summary.todayCostUsd, null);
});

test("does not invent a subscription discount", () => {
  assert.equal(estimateSubscriptionCost(100, "max-20x"), null);
  assert.equal(estimateSubscriptionCost(100, null), null);
});
