import type { PgBoss } from "pg-boss";

import { logger } from "../../utils/logger.js";
import type { Database } from "../../db/index.js";
import { ingestJsonlFile } from "../../conversation-ingest.js";
import type { IngestJob } from "../queues.js";

export type IngestHandler = (job: IngestJob) => Promise<void>;

export interface WorkerHandlers {
  ingest: IngestHandler;
}

export function createIngestHandler(db: Database): IngestHandler {
  return async (job) => {
    await ingestJsonlFile(db, job.filePath, job.projectPath);
  };
}

export async function registerWorkers(
  boss: PgBoss,
  handlers: WorkerHandlers,
): Promise<void> {
  await boss.work<IngestJob>("claude-run.ingest", async ([job]) => {
    logger.debug(`processing ingest job: ${job.id}`);
    await handlers.ingest(job.data);
    logger.debug(`completed ingest job: ${job.id}`);
    return undefined;
  });
  logger.info("pg-boss worker registered: claude-run.ingest");
}
