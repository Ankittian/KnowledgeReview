import { defineConfig } from "drizzle-kit";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* absent */
  }
}

const url = process.env.DATABASE_URL;

// `npm run db:studio` browses the managed DB when DATABASE_URL is set, otherwise the local embedded PGlite database.
export default defineConfig(
  url
    ? { dialect: "postgresql", schema: "./db/schema.ts", out: "./db/migrations", dbCredentials: { url } }
    : {
        dialect: "postgresql",
        driver: "pglite",
        schema: "./db/schema.ts",
        out: "./db/migrations",
        dbCredentials: { url: process.env.PGLITE_DIR ?? "./.data/pglite" },
      },
);
