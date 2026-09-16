import assert from "node:assert/strict";
import test from "node:test";

import { SdkAgentDriver, type SdkQuery } from "../api/drivers/sdk-driver.js";

test("loads user, project, and local Claude settings by default", async () => {
  let captured: Record<string, unknown> | undefined;
  const query: SdkQuery = ({ options }) => {
    captured = options;
    return (async function* () {
      yield { type: "result", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  };

  const driver = new SdkAgentDriver({ query, model: "sonnet", maxBudgetUsd: 0.05 });
  await driver.start({ repo: "/work/repo", acceptEdits: false });
  await driver.sendPrompt("use the repository instructions");

  assert.deepEqual(captured?.settingSources, ["user", "project", "local"]);
});

test("allows an explicit settings source policy", async () => {
  let captured: Record<string, unknown> | undefined;
  const query: SdkQuery = ({ options }) => {
    captured = options;
    return (async function* () {
      yield { type: "result", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  };

  const driver = new SdkAgentDriver({
    query,
    model: "sonnet",
    maxBudgetUsd: 0.05,
    settingSources: [],
  });
  await driver.start({ repo: "/work/repo", acceptEdits: false });
  await driver.sendPrompt("run without filesystem settings");

  assert.deepEqual(captured?.settingSources, []);
});
