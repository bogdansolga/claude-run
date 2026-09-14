import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentManager,
  type AgentEventRecord,
} from "../api/agent-manager.js";
import { FakeAgentDriver } from "../api/drivers/agent-driver.js";

test("creates a fake agent and forwards prompts and driver events", async () => {
  const drivers: FakeAgentDriver[] = [];
  const manager = new AgentManager(() => {
    const driver = new FakeAgentDriver();
    drivers.push(driver);
    return driver;
  });

  const session = await manager.create({ repo: "/tmp/project", acceptEdits: false });
  const events: AgentEventRecord[] = [];
  const unsubscribe = manager.subscribe(session.id, (event) => events.push(event));

  await manager.prompt(session.id, "status update");
  drivers[0].completeTurn({ outputTokens: 3 });

  assert.equal(manager.get(session.id)?.state, "idle");
  assert.deepEqual(drivers[0].prompts, ["status update"]);
  assert.deepEqual(
    events.map((event) => [event.seq, event.type]),
    [[2, "turn_complete"]],
  );
  unsubscribe();
});

test("replays only events after the requested sequence", async () => {
  const drivers: FakeAgentDriver[] = [];
  const manager = new AgentManager(() => {
    const driver = new FakeAgentDriver();
    drivers.push(driver);
    return driver;
  });
  const session = await manager.create({ repo: "/tmp/project", acceptEdits: false });

  await manager.prompt(session.id, "first");
  drivers[0].completeTurn({ outputTokens: 1 });
  await manager.prompt(session.id, "second");
  drivers[0].completeTurn({ outputTokens: 2 });

  assert.deepEqual(manager.events(session.id, 2).map((event) => event.seq), [3]);
  assert.deepEqual(manager.events(session.id, 3), []);
});

test("subscribes before replay to avoid an event gap", async () => {
  const manager = new AgentManager(() => new FakeAgentDriver());
  const session = await manager.create({ repo: "/tmp/project", acceptEdits: false });
  const received: number[] = [];
  const subscription = manager.getReplayAndSubscribe(session.id, 1, (event) => {
    received.push(event.seq);
  });
  manager.recordEventForTest(session.id, "assistant_text", { delta: "hello" });
  assert.deepEqual(subscription.replay, []);
  assert.deepEqual(received, [2]);
  subscription.unsubscribe();
});

test("interrupts and kills an agent exactly once", async () => {
  const manager = new AgentManager(() => new FakeAgentDriver());
  const session = await manager.create({ repo: "/tmp/project", acceptEdits: true });

  await manager.prompt(session.id, "run checks");
  await manager.interrupt(session.id);
  assert.equal(manager.get(session.id)?.state, "idle");

  await manager.kill(session.id);
  await assert.rejects(() => manager.prompt(session.id, "after exit"), /ended/);
  assert.equal(manager.get(session.id)?.state, "ended");
});

test("rejects unknown agents", async () => {
  const manager = new AgentManager(() => new FakeAgentDriver());

  assert.throws(() => manager.getRequired("missing"), /Unknown agent/);
  await assert.rejects(() => manager.prompt("missing", "hello"), /Unknown agent/);
});
