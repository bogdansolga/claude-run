import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  initWatcher,
  onSessionChange,
  offSessionChange,
  startWatcher,
  stopWatcher,
} from "../api/watcher.js";

test("watcher emits the changed JSONL path at the ingest boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "claude-run-watcher-"));
  const projectDirectory = join(directory, "projects", "-work-project");
  const filePath = join(projectDirectory, "session.jsonl");
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(filePath, "{}");

  const changes: Array<{ sessionId: string; filePath: string }> = [];
  const listener = (sessionId: string, changedPath: string) => {
    changes.push({ sessionId, filePath: changedPath });
  };

  initWatcher(directory);
  onSessionChange(listener);
  startWatcher();

  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await writeFile(filePath, "{}\n");
    for (let attempt = 0; attempt < 50 && changes.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.deepEqual(changes, [{ sessionId: "session", filePath }]);
  } finally {
    offSessionChange(listener);
    stopWatcher();
    await rm(directory, { recursive: true, force: true });
  }
});
