import assert from "node:assert/strict";
import test from "node:test";

import { SdkAgentDriver, type SdkQuery } from "../api/drivers/sdk-driver.js";

test("SDK user dialogs become pending questions and resolve exactly once", async () => {
  let options: Record<string, unknown> | undefined;
  const query: SdkQuery = (request) => {
    options = request.options;
    return (async function* () {
      const onUserDialog = options?.onUserDialog as (
        request: { dialogKind: string; payload: Record<string, unknown>; toolUseID?: string },
        details: { signal: AbortSignal; requestId: string },
      ) => Promise<unknown>;
      const result = await onUserDialog(
        { dialogKind: "question", payload: { question: "Which branch?" }, toolUseID: "question-1" },
        { signal: new AbortController().signal, requestId: "request-1" },
      );
      assert.deepEqual(result, { behavior: "completed", result: "main" });
      yield { type: "result", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  };
  const driver = new SdkAgentDriver({
    query,
    model: "sonnet",
    maxBudgetUsd: 0.1,
    supportedDialogKinds: ["question"],
  });
  const questions: Array<Record<string, unknown>> = [];
  driver.on("question", (payload) => questions.push(payload));

  await driver.start({ repo: "/repo", acceptEdits: false });
  const turn = driver.sendPrompt("choose a branch");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(questions, [{ promptId: "question-1", question: "Which branch?", dialogKind: "question", payload: { question: "Which branch?" } }]);
  await driver.answerQuestion("question-1", "main");
  await turn;
  await assert.rejects(() => driver.answerQuestion("question-1", "other"), /unknown|resolved/i);
});

test("unsupported SDK dialogs are cancelled", async () => {
  let options: Record<string, unknown> | undefined;
  const query: SdkQuery = (request) => {
    options = request.options;
    return (async function* () {
      const onUserDialog = options?.onUserDialog as (
        request: { dialogKind: string; payload: Record<string, unknown> },
        details: { signal: AbortSignal; requestId: string },
      ) => Promise<unknown>;
      assert.deepEqual(
        await onUserDialog({ dialogKind: "future-dialog", payload: {} }, { signal: new AbortController().signal, requestId: "request-2" }),
        { behavior: "cancelled" },
      );
      yield { type: "result", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  };
  const driver = new SdkAgentDriver({ query, model: "sonnet", maxBudgetUsd: 0.1, supportedDialogKinds: ["question"] });
  await driver.start({ repo: "/repo", acceptEdits: false });
  await driver.sendPrompt("continue");
});
