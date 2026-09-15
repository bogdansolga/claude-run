import assert from "node:assert/strict";
import test from "node:test";

import { SdkAgentDriver, type SdkQuery } from "../api/drivers/sdk-driver.js";

test("SDK permission requests wait for exactly one host resolution", async () => {
  let resolveQuery: (() => void) | undefined;
  let options: Record<string, unknown> | undefined;
  const query: SdkQuery = (request) => {
    options = request.options;
    return (async function* () {
      const canUseTool = options?.canUseTool as ((name: string, input: Record<string, unknown>, details: { signal: AbortSignal; toolUseID?: string }) => Promise<unknown>);
      const decision = await canUseTool("Bash", { command: "pwd" }, { signal: new AbortController().signal, toolUseID: "tool-1" });
      assert.deepEqual(decision, { behavior: "allow", toolUseID: "tool-1" });
      yield { type: "result", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  };
  const driver = new SdkAgentDriver({ query, model: "sonnet", maxBudgetUsd: 0.1 });
  const requests: unknown[] = [];
  driver.on("permission_request", (payload) => {
    requests.push(payload);
    resolveQuery = () => void driver.resolvePermission(String(payload.promptId), { allow: true });
  });
  await driver.start({ repo: "/repo", acceptEdits: false });
  const turn = driver.sendPrompt("run pwd");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  resolveQuery?.();
  await turn;
  await assert.rejects(() => driver.resolvePermission(String((requests[0] as { promptId: string }).promptId), { allow: true }), /unknown|resolved/i);
});

test("interrupt rejects a pending SDK permission", async () => {
  let options: Record<string, unknown> | undefined;
  const query: SdkQuery = (request) => {
    options = request.options;
    return (async function* () {
      const canUseTool = options?.canUseTool as (name: string, input: Record<string, unknown>, details: { signal: AbortSignal }) => Promise<unknown>;
      await canUseTool("Bash", {}, { signal: new AbortController().signal });
      yield { type: "result", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  };
  const driver = new SdkAgentDriver({ query, model: "sonnet", maxBudgetUsd: 0.1 });
  await driver.start({ repo: "/repo", acceptEdits: false });
  const turn = driver.sendPrompt("run it");
  await new Promise((resolve) => setImmediate(resolve));
  await driver.interrupt();
  await assert.rejects(turn, /interrupt/i);
});
