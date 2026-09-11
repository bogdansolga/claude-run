import { execFileSync } from "node:child_process";
import { Client } from "pg";

import { logger } from "../../api/utils/logger.js";

import {
  assertSafeDatabaseName,
  getAdminConnectionString,
  getDatabaseName,
  loadDatabaseConfig,
} from "../../api/db/config.js";

async function main(): Promise<void> {
  const config = loadDatabaseConfig(process.env);
  const databaseName = getDatabaseName(config.connectionString);
  assertSafeDatabaseName(databaseName);
  logger.info(`Ensuring PostgreSQL database exists: ${databaseName}`);

  const adminConnectionString = getAdminConnectionString(config.connectionString);
  const admin = new Client({ connectionString: adminConnectionString });
  try {
    await admin.connect();
  } catch (error) {
    logger.error("Failed to connect to PostgreSQL admin database", error);
    throw error;
  }

  try {
    const result = await admin.query<{ exists: boolean }>(
      "select exists (select 1 from pg_database where datname = $1) as exists",
      [databaseName],
    );

    if (!result.rows[0]?.exists) {
      const quotedName = `"${databaseName.replaceAll('"', '""')}"`;
      await admin.query(`create database ${quotedName}`);
      logger.info(`Created PostgreSQL database ${databaseName}`);
    } else {
      logger.info(`PostgreSQL database ${databaseName} already exists`);
    }
  } finally {
    await admin.end();
  }

  execFileSync("bun", ["run", "db:migrate"], {
    cwd: new URL("../..", import.meta.url),
    env: {
      ...process.env,
      DATABASE_URL: config.connectionString,
    },
    stdio: "inherit",
  });
  logger.info(`Database ready: ${config.connectionString.replace(/:[^:@/]+@/, ":***@")}`);
}

await main();
