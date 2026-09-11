/**
 * Process-start instrumentation adapted from finances-manager.
 *
 * claude-run is not a Next.js application, so the lifecycle is explicit:
 * `register()` starts pg-boss and registers workers, while `shutdown()` stops
 * the runtime. Initialization is idempotent for dev watchers and tests.
 */
import { loadDatabaseConfig } from "./db/config.js";
import { createDatabase } from "./db/index.js";
import { enqueueIngest, startQueueRuntime, type QueueRuntime } from "./jobs/queue.js";
import { createIngestHandler, registerWorkers } from "./jobs/workers/index.js";
import { listSessionFiles } from "./storage.js";
import { logger } from "./utils/logger.js";

let runtime: QueueRuntime | null = null;
let registration: Promise<QueueRuntime | null> | null = null;
let database: ReturnType<typeof createDatabase> | null = null;

export async function register(
  env: NodeJS.ProcessEnv = process.env,
): Promise<QueueRuntime | null> {
  if (runtime) return runtime;
  if (registration) return registration;

  if (env.CLAUDE_RUN_DISABLE_WORKERS === "1") {
    logger.info("[instrumentation] pg-boss workers disabled");
    return null;
  }

  registration = (async () => {
    try {
      const config = loadDatabaseConfig(env);
      logger.info("[instrumentation] Starting pg-boss and registering workers");
      const started = await startQueueRuntime(config.connectionString);
      database = createDatabase(env);
      await registerWorkers(started.boss, {
        ingest: createIngestHandler(database.db),
      });
      const sessionFiles = await listSessionFiles();
      let enqueuedCount = 0;
      for (const filePath of sessionFiles) {
        const jobId = await enqueueIngest(started.boss, { filePath });
        if (jobId) enqueuedCount += 1;
      }
      logger.debug(
        `[instrumentation] initial ingest scan considered ${sessionFiles.length} file(s), enqueued ${enqueuedCount}`,
      );
      runtime = started;
      logger.info("[instrumentation] pg-boss workers registered successfully");
      return started;
    } catch (error) {
      logger.error("[instrumentation] Failed to initialize pg-boss workers", error);
      return null;
    } finally {
      registration = null;
    }
  })();

  return registration;
}

export async function shutdown(): Promise<void> {
  const active = runtime;
  runtime = null;
  if (active) {
    await active.stop();
    logger.info("[instrumentation] pg-boss shutdown complete");
  }
  if (database) {
    await database.pool.end();
    database = null;
  }
}

export function getQueueRuntime(): QueueRuntime | null {
  return runtime;
}
