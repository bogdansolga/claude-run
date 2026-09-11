import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  dialect: "postgresql",
  out: "./api/db/migrations",
  schema: "./api/db/schema.ts",
  schemaFilter: ["claude_run"],
});
