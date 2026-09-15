import assert from "node:assert/strict";
import test from "node:test";

import { SdkAgentDriver, type SdkQuery } from "../api/drivers/sdk-driver.js";

test("runs one bounded SDK turn and emits text, completion, and usage", async () => {
  const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
  const query: SdkQuery = (request) => {
    calls.push({ prompt: request.prompt, options: request.options });
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: "sdk-session-1" };
      yield { type: "assistant", message: { content: [{ type: "text", text: "Hello from SDK" }] } };
      yield {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.0123,
        usage: { input_tokens: 10, output_tokens: 4 },
      };
    })();
  };
  const driver = new SdkAgentDriver({ query, model: "claude-sonnet-4-5", maxBudgetUsd: 0.05 });
  const text: string[] = [];
  const usage: unknown[] = [];
  driver.on("assistant_text", (payload) => text.push(String(payload.delta)));
  driver.on("turn_complete", (payload) => usage.push(payload.usage));

  assert.deepEqual(await driver.start({ repo: "/work/repo", acceptEdits: false }), { sessionId: "sdk-session" });
  await driver.sendPrompt("say hello");

  assert.deepEqual(text, ["Hello from SDK"]);
  assert.deepEqual(usage, [{ inputTokens: 10, outputTokens: 4, costUsd: 0.0123, model: "claude-sonnet-4-5" }]);
  assert.equal(calls[0]?.prompt, "say hello");
  assert.equal(calls[0]?.options.model, "claude-sonnet-4-5");
  assert.equal(calls[0]?.options.maxBudgetUsd, 0.05);
});

test("uses the streamed session id for the next prompt and aborts in-flight work", async () => {
  let resolveQuery: (() => void) | undefined;
  let capturedOptions: Record<string, unknown> | undefined;
  const query: SdkQuery = (request) => {
    capturedOptions = request.options;
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: "sdk-session-1" };
      await new Promise<void>((resolve) => {
        resolveQuery = resolve;
      });
    })();
  };
  const driver = new SdkAgentDriver({ query, model: "claude-sonnet-4-5", maxBudgetUsd: 0.05 });
  await driver.start({ repo: "/work/repo", acceptEdits: false });
  const turn = driver.sendPrompt("first");
  await new Promise((resolve) => setImmediate(resolve));
  await driver.interrupt();
  resolveQuery?.();
  await turn;
  assert.ok(capturedOptions?.abortController instanceof AbortController);

  const calls: Record<string, unknown>[] = [];
  const resumed = new SdkAgentDriver({
    query: ({ options }) => {
      calls.push(options);
      return (async function* () {
        yield { type: "result", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } };
      })();
    },
    model: "claude-sonnet-4-5",
    maxBudgetUsd: 0.05,
  });
  await resumed.start({ repo: "/work/repo", resume: "sdk-session-1", acceptEdits: false });
  await resumed.sendPrompt("second");
  assert.equal(calls[0]?.resume, "sdk-session-1");
});

test("refuses a turn when the budget is already exhausted", async () => {
  let called = false;
  const query: SdkQuery = () => {
    called = true;
    return (async function* () {})();
  };
  const driver = new SdkAgentDriver({ query, model: "claude-sonnet-4-5", maxBudgetUsd: 0.01, spentUsd: 0.01 });
  await driver.start({ repo: "/work/repo", acceptEdits: false });
  await assert.rejects(() => driver.sendPrompt("do work"), /budget/i);
  assert.equal(called, false);
});
