import { PgBoss } from "pg-boss";

import { logger } from "../utils/logger.js";
import type { QueueDefinition } from "./queues.js";
import { queueDefinitions } from "./queues.js";

export interface QueueRuntime {
  boss: PgBoss;
  stop(): Promise<void>;
}

export async function startQueueRuntime(
  connectionString: string,
  definitions: readonly QueueDefinition<unknown>[] = queueDefinitions,
): Promise<QueueRuntime> {
  const boss = new PgBoss({
    connectionString,
    schema: "pgboss",
    createSchema: true,
    supervise: false,
    monitorVacuum: false,
    reindex: false,
  });

  await boss.start();
  logger.info(`pg-boss started using schema pgboss`);
  for (const definition of definitions) {
    await boss.createQueue(definition.name, definition.options);
    logger.info(`pg-boss queue ready: ${definition.name}`);
  }

  return {
    boss,
    stop: async () => {
      await boss.stop();
      logger.info("pg-boss stopped");
    },
  };
}

export async function enqueueIngest(
  boss: PgBoss,
  payload: { filePath: string; projectPath?: string; sessionId?: string },
): Promise<string | null> {
  const jobId = await boss.send("claude-run.ingest", payload, {
    singletonKey: payload.filePath,
    singletonSeconds: 60,
  });
  // Enqueue activity is intentionally debug-only. A null job ID means pg-boss
  // rejected the singleton as already queued; that is normal and should stay
  // silent even at debug level.
  if (jobId) {
    logger.debug(`ingest job enqueued: ${payload.filePath}`);
  }
  return jobId;
}
