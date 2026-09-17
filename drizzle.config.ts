import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./apps/api/migrations",
  dialect: "postgresql",
  schema: "./apps/api/src/drizzle/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://vultstrike:vultstrike@localhost:5433/vultstrike"
  },
  strict: true,
  verbose: true
});
