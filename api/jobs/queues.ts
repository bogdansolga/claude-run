import type { QueueOptions } from "pg-boss";

export interface IngestJob {
  filePath: string;
  projectPath?: string;
  sessionId?: string;
}

export interface QueueDefinition<T> {
  name: string;
  retryLimit: NonNullable<QueueOptions["retryLimit"]>;
  options: QueueOptions;
  isPayload(value: unknown): value is T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const ingestQueue: QueueDefinition<IngestJob> = {
  name: "claude-run.ingest",
  retryLimit: 3,
  options: {
    retryBackoff: true,
    retryDelay: 1,
    retryLimit: 3,
  },
  isPayload(value): value is IngestJob {
    return isRecord(value) && typeof value.filePath === "string";
  },
};

export const queueDefinitions = [ingestQueue] as const;
