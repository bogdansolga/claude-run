import assert from "node:assert/strict";
import test from "node:test";

import { PgBoss } from "pg-boss";
import { Client } from "pg";

import { enqueueIngest, startQueueRuntime } from "../api/jobs/queue.js";
import { registerWorkers } from "../api/jobs/workers/index.js";

const databaseUrl = process.env.DATABASE_URL;

test("PostgreSQL schemas and pg-boss can enqueue and process an ingest job", { skip: !databaseUrl }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const runtime = await startQueueRuntime(databaseUrl!);
  try {
    const schemas = await client.query<{ schema_name: string }>(
      "select schema_name from information_schema.schemata where schema_name in ('claude_run', 'pgboss') order by schema_name",
    );
    assert.deepEqual(schemas.rows.map((row) => row.schema_name), ["claude_run", "pgboss"]);

    let processed: unknown;
    await registerWorkers(runtime.boss, {
      ingest: async (job) => {
        processed = job;
      },
    });

    const filePath = `/tmp/slice-1-${Date.now()}.jsonl`;
    const jobId = await enqueueIngest(runtime.boss, {
      filePath,
      projectPath: "/tmp/project",
    });
    assert.ok(jobId);
    await runtime.boss.notifyWorker("claude-run.ingest");

    for (let attempt = 0; attempt < 40 && processed === undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.deepEqual(processed, {
      filePath,
      projectPath: "/tmp/project",
    });
  } finally {
    await runtime.stop();
    await client.end();
  }
});
