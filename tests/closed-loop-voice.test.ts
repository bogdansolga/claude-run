import assert from "node:assert/strict";
import test from "node:test";

import { AgentManager } from "../api/agent-manager.js";
import { FakeAgentDriver } from "../api/drivers/agent-driver.js";
import { FakeTtsProvider } from "../api/voice/types.js";

test("a transcript becomes a prompt and agent output becomes audio", async () => {
  let driver!: FakeAgentDriver;
  const manager = new AgentManager(() => {
    driver = new FakeAgentDriver();
    return driver;
  }, { tts: new FakeTtsProvider() });
  const session = await manager.create({ repo: "/tmp/project", acceptEdits: false });
  const events: string[] = [];
  const audio: string[] = [];
  manager.subscribe(session.id, (event) => events.push(event.type));
  manager.subscribeAudio(session.id, (event) => {
    if (event.type === "audio") audio.push(event.clipId);
  });

  await manager.acceptTranscript(session.id, "Run the tests");
  assert.deepEqual(driver.prompts, ["Run the tests"]);
  assert.deepEqual(events, ["transcript"]);

  manager.recordEventForTest(session.id, "assistant_text", { delta: "Tests passed." });
  await manager.flushVoice(session.id);
  assert.deepEqual(audio, ["speech-1"]);
});

test("an empty transcript is rejected without prompting the agent", async () => {
  const driver = new FakeAgentDriver();
  const manager = new AgentManager(() => driver);
  const session = await manager.create({ repo: "/tmp/project", acceptEdits: false });
  await assert.rejects(() => manager.acceptTranscript(session.id, "  "), /empty/i);
  assert.deepEqual(driver.prompts, []);
});
