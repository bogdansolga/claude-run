import assert from "node:assert/strict";
import test from "node:test";

import { AgentManager } from "../api/agent-manager.js";
import { FakeAgentDriver } from "../api/drivers/agent-driver.js";
import { FakeTtsProvider } from "../api/voice/types.js";

test("agent output emits text events before audio and isolates TTS failures", async () => {
  const drivers: FakeAgentDriver[] = [];
  const manager = new AgentManager(
    () => {
      const driver = new FakeAgentDriver();
      drivers.push(driver);
      return driver;
    },
    { tts: new FakeTtsProvider() },
  );
  const session = await manager.create({ repo: "/tmp/project", acceptEdits: false });
  const textEvents: string[] = [];
  const audioEvents: string[] = [];
  manager.subscribe(session.id, (event) => {
    if (event.type === "assistant_text") textEvents.push(String(event.payload.delta));
  });
  manager.subscribeAudio(session.id, (event) => {
    if (event.type === "audio") audioEvents.push(event.clipId);
  });

  manager.recordEventForTest(session.id, "assistant_text", { delta: "Hello." });
  await manager.flushVoice(session.id);

  assert.deepEqual(textEvents, ["Hello."]);
  assert.deepEqual(audioEvents, ["speech-1"]);
  assert.equal(drivers.length, 1);
});

test("audio failure does not prevent the agent event", async () => {
  const manager = new AgentManager(() => new FakeAgentDriver(), {
    tts: new FakeTtsProvider({ fail: true }),
  });
  const session = await manager.create({ repo: "/tmp/project", acceptEdits: false });
  const events: string[] = [];
  manager.subscribe(session.id, (event) => events.push(event.type));
  const audioErrors: string[] = [];
  manager.subscribeAudio(session.id, (event) => {
    if (event.type === "audio_error") audioErrors.push(event.message);
  });

  manager.recordEventForTest(session.id, "assistant_text", { delta: "Still visible." });
  await manager.flushVoice(session.id);

  assert.deepEqual(events, ["assistant_text"]);
  assert.deepEqual(audioErrors, ["fake TTS failure"]);
});
