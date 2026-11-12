// Fresh database for the E2E run: wipe .data/e2e-pglite, migrate, sync cards, seed the admin.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const dir = path.resolve(process.env.PGLITE_DIR ?? ".data/e2e-pglite");
if (!dir.includes("e2e")) throw new Error(`Refusing to wipe a non-e2e database: ${dir}`);
fs.rmSync(dir, { recursive: true, force: true });
for (const s of ["migrate", "sync-cards", "seed-admin"]) execSync(`npx tsx scripts/${s}.ts`, { stdio: "inherit", env: process.env });
