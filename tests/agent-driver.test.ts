import assert from "node:assert/strict";
import test from "node:test";

import {
  FakeAgentDriver,
  transitionAgentState,
} from "../api/drivers/agent-driver";

test("agent state transitions cover a prompt and completion", () => {
  assert.equal(transitionAgentState("idle", "prompt"), "thinking");
  assert.equal(transitionAgentState("thinking", "complete"), "idle");
  assert.equal(transitionAgentState("thinking", "permission"), "awaiting_permission");
  assert.equal(transitionAgentState("awaiting_permission", "resolved"), "thinking");
  assert.equal(transitionAgentState("thinking", "exit"), "ended");
});

test("fake driver preserves resume identity and emits lifecycle events", async () => {
  const driver = new FakeAgentDriver();
  const events: string[] = [];
  driver.on("session_id", (payload) => events.push(String(payload.sessionId)));
  driver.on("turn_complete", () => events.push("complete"));

  assert.deepEqual(await driver.start({ repo: "/work/repo", resume: "resume-123", acceptEdits: true }), {
    sessionId: "resume-123",
  });
  await driver.sendPrompt("hello");
  driver.completeTurn({ inputTokens: 3 });

  assert.deepEqual(events, ["resume-123", "complete"]);
  assert.deepEqual(driver.prompts, ["hello"]);
  assert.equal(driver.state, "idle");
});
