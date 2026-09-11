import assert from "node:assert/strict";
import test from "node:test";

import { getQueueRuntime, register, shutdown } from "../api/instrumentation.js";

test("instrumentation can be disabled without opening a database connection", async () => {
  const previous = process.env.CLAUDE_RUN_DISABLE_WORKERS;
  process.env.CLAUDE_RUN_DISABLE_WORKERS = "1";

  try {
    assert.equal(await register(), null);
    assert.equal(getQueueRuntime(), null);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_RUN_DISABLE_WORKERS;
    else process.env.CLAUDE_RUN_DISABLE_WORKERS = previous;
    await shutdown();
  }
});
