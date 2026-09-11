import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { loadDatabaseConfig } from "./config.js";
import * as schema from "./schema.js";

export function createDatabase(
  env: NodeJS.ProcessEnv = process.env,
): { db: ReturnType<typeof drizzle<typeof schema>>; pool: Pool } {
  const config = loadDatabaseConfig(env);
  const pool = new Pool({ connectionString: config.connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>["db"];
