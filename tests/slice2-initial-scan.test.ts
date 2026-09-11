import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initStorage, listSessionFiles } from "../api/storage.js";

test("lists existing JSONL session files for the initial ingest scan", async () => {
  const directory = await mkdtemp(join(tmpdir(), "claude-run-scan-"));
  const projectDirectory = join(directory, "projects", "-work-project");
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(join(projectDirectory, "session-1.jsonl"), "");
  await writeFile(join(projectDirectory, "not-a-session.txt"), "");

  try {
    initStorage(directory);
    assert.deepEqual(await listSessionFiles(), [join(projectDirectory, "session-1.jsonl")]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
