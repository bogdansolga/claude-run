import { logger } from "../utils/logger.js";

export interface DatabaseConfig {
  connectionString: string;
  applicationSchema: string;
  jobSchema: string;
}

function buildLocalConnectionString(env: NodeJS.ProcessEnv): string {
  const user = env.PGUSER ?? env.USER ?? "postgres";
  const host = env.PGHOST ?? "localhost";
  const port = env.PGPORT ?? "5432";
  const database = env.CLAUDE_RUN_DB_NAME ?? "claude_run";
  const password = env.PGPASSWORD;
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = password ? `:${encodeURIComponent(password)}` : "";

  return `postgresql://${encodedUser}${encodedPassword}@${host}:${port}/${database}`;
}

export function loadDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  const connectionString = env.DATABASE_URL || buildLocalConnectionString(env);
  logger.debug(`database URL source: ${env.DATABASE_URL ? "DATABASE_URL" : "local defaults"}`);
  return {
    connectionString,
    applicationSchema: env.CLAUDE_RUN_DB_SCHEMA ?? "claude_run",
    jobSchema: env.CLAUDE_RUN_JOB_SCHEMA ?? "pgboss",
  };
} 

export function getDatabaseName(connectionString: string): string {
  const database = new URL(connectionString).pathname.slice(1);
  if (!database) {
    throw new Error("Database connection string must include a database name");
  }
  return decodeURIComponent(database);
} 

export function getAdminConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = "/postgres";
  return url.toString();
} 

export function assertSafeDatabaseName(database: string): void {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) {
    logger.error(`Rejected unsafe PostgreSQL database name: ${database}`);
    throw new Error(`Unsafe PostgreSQL database name: ${database}`);
  }
} 

export { buildLocalConnectionString };
