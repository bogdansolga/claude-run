import assert from "node:assert/strict";
import test from "node:test";

import { AgentManager } from "../api/agent-manager.js";
import { FakeAgentDriver } from "../api/drivers/agent-driver.js";
import { VoiceCommandService } from "../api/voice-command-service.js";

test("executes stop/repeat, routes prompts, and does not guess sessions", async () => {
  const driver = new FakeAgentDriver();
  const manager = new AgentManager(() => driver);
  const session = await manager.create({ repo: "/tmp/project", acceptEdits: false });
  const service = new VoiceCommandService(manager);

  assert.equal((await service.execute(session.id, "stop speaking")).kind, "stop");
  assert.equal((await service.execute(session.id, "repeat")).kind, "repeat");
  assert.equal((await service.execute(session.id, "run the tests")).kind, "prompt");
  assert.deepEqual(driver.prompts, ["run the tests"]);
  assert.equal((await service.execute(session.id, "switch to session fix", [
    { id: "a", display: "Fix tests" },
    { id: "b", display: "Fix docs" },
  ])).kind, "clarification");
});

test("returns explicit selection and new-session intent", async () => {
  const manager = new AgentManager(() => new FakeAgentDriver());
  const session = await manager.create({ repo: "/tmp/project", acceptEdits: false });
  const service = new VoiceCommandService(manager);
  const selected = await service.execute(session.id, "select session deploy", [{ id: "deploy-id", display: "Deploy" }]);
  assert.deepEqual(selected, { kind: "switch_session", intent: { kind: "switch_session", query: "deploy" }, sessionId: "deploy-id" });
  assert.equal((await service.execute(session.id, "new session")).kind, "new_session");
});
