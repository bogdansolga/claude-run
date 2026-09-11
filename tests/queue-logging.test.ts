import assert from "node:assert/strict";
import test from "node:test";

test("enqueueIngest logs accepted jobs only at debug level and suppresses duplicates", async () => {
  const originalDebugLevel = process.env.DEBUG_LEVEL;
  process.env.DEBUG_LEVEL = "debug";

  const calls: string[] = [];
  const originalDebug = console.debug;
  const originalInfo = console.info;
  console.debug = (...args: unknown[]) => calls.push(String(args[0]));
  console.info = (...args: unknown[]) => calls.push(String(args[0]));

  try {
    const { enqueueIngest } = await import("../api/jobs/queue.js");
    const boss = { send: async () => "job-1" } as never;
    await enqueueIngest(boss, { filePath: "/tmp/session.jsonl" });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /ingest job enqueued/);

    calls.length = 0;
    const deduplicatingBoss = { send: async () => null } as never;
    await enqueueIngest(deduplicatingBoss, { filePath: "/tmp/session.jsonl" });
    assert.deepEqual(calls, []);
  } finally {
    console.debug = originalDebug;
    console.info = originalInfo;
    if (originalDebugLevel === undefined) delete process.env.DEBUG_LEVEL;
    else process.env.DEBUG_LEVEL = originalDebugLevel;
  }
});
