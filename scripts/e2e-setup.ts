// Fresh database for the E2E run: wipe knowledge_review_e2e, migrate, sync cards, seed the admin.
import "./_env";
import { execSync } from "node:child_process";
import { createDb, resetDatabase } from "@/db/client";

const url = process.env.DATABASE_URL ?? "";
if (!/e2e/i.test(url)) throw new Error("Refusing to run E2E setup: DATABASE_URL must point at an *e2e* database.");
const h = createDb();
await resetDatabase(h);
await h.close();
for (const s of ["migrate", "sync-cards", "seed-admin"]) execSync(`npx tsx scripts/${s}.ts`, { stdio: "inherit", env: process.env });
