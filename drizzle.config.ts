import { defineConfig } from "drizzle-kit";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* absent */
  }
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");

export default defineConfig({ dialect: "postgresql", schema: "./db/schema.ts", out: "./db/migrations", dbCredentials: { url } });
