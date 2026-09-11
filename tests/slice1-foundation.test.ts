import assert from "node:assert/strict";
import test from "node:test";

import { loadDatabaseConfig } from "../api/db/config.js";
import { ingestQueue, type IngestJob } from "../api/jobs/queues.js";

test("database configuration derives a local URL when DATABASE_URL is absent", () => {
  const config = loadDatabaseConfig({
    PGHOST: "localhost",
    PGPORT: "5432",
    PGUSER: "bsolga",
    CLAUDE_RUN_DB_NAME: "claude_run_test",
  });

  assert.equal(
    config.connectionString,
    "postgresql://bsolga@localhost:5432/claude_run_test",
  );
  assert.equal(config.applicationSchema, "claude_run");
  assert.equal(config.jobSchema, "pgboss");
});

test("explicit DATABASE_URL takes precedence over generated local URL", () => {
  const config = loadDatabaseConfig({
    DATABASE_URL: "postgresql://example.invalid:5432/explicit",
    PGUSER: "ignored",
  });

  assert.equal(config.connectionString, "postgresql://example.invalid:5432/explicit");
});

test("ingest queue defines a stable payload and retry policy", () => {
  const payload: IngestJob = {
    filePath: "/tmp/session.jsonl",
    projectPath: "/tmp/project",
  };

  assert.deepEqual(payload, {
    filePath: "/tmp/session.jsonl",
    projectPath: "/tmp/project",
  });
  assert.equal(ingestQueue.name, "claude-run.ingest");
  assert.equal(ingestQueue.retryLimit, 3);
});
