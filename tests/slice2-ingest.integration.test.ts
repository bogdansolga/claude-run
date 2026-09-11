import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sql } from "drizzle-orm";

import { createDatabase } from "../api/db/index.js";
import { ingestJsonlFile } from "../api/conversation-ingest.js";

const databaseUrl = process.env.DATABASE_URL;

test("ingesting the same JSONL file twice does not duplicate rows", { skip: !databaseUrl }, async () => {
  const { db, pool } = createDatabase({ DATABASE_URL: databaseUrl });
  const directory = await mkdtemp(join(tmpdir(), "claude-run-slice2-"));
  const filePath = join(directory, "session.jsonl");
  const sessionId = `slice-2-${Date.now()}`;

  await writeFile(
    filePath,
    [
      JSON.stringify({ type: "user", uuid: `${sessionId}-user`, sessionId, message: { role: "user", content: "hello" } }),
      JSON.stringify({ type: "assistant", uuid: `${sessionId}-assistant`, sessionId, message: { role: "assistant", content: "world", usage: { input_tokens: 3, output_tokens: 2 } } }),
    ].join("\n") + "\n",
  );

  try {
    await ingestJsonlFile(db, filePath, "/work/project");
    await ingestJsonlFile(db, filePath, "/work/project");

    const result = await db.execute(sql`
      select
        (select count(*)::int from claude_run.conversations where claude_session_id = ${sessionId}) as conversations,
        (select count(*)::int from claude_run.messages where claude_message_id like ${`${sessionId}-%`}) as messages,
        (select count(*)::int from claude_run.usage_turns where claude_message_id like ${`${sessionId}-%`}) as usage_turns
    `);

    assert.deepEqual(result.rows[0], { conversations: 1, messages: 2, usage_turns: 1 });
  } finally {
    await db.execute(sql`delete from claude_run.messages where claude_message_id like ${`${sessionId}-%`}`);
    await db.execute(sql`delete from claude_run.conversations where claude_session_id = ${sessionId}`);
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
