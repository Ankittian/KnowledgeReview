import path from "node:path";
import fs from "node:fs";
import { sql, type SQL } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: DB;
  close: () => Promise<void>;
}

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");
const VIEWS_FILE = path.join(process.cwd(), "db", "views.sql");

/**
 * Connects to Postgres (Docker locally and on EC2, or any managed Postgres).
 * `DATABASE_URL` is required: postgresql://user:password@host:5432/dbname
 */
export function createDb(opts: { url?: string } = {}): DbHandle {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Start Postgres with `docker compose up -d` and set DATABASE_URL in .env (see .env.example).",
    );
  }
  // prepare:false keeps transaction-mode poolers (PgBouncer, Supabase, Neon pooled) happy.
  const client = postgres(url, { prepare: false, max: Number(process.env.DB_POOL_MAX ?? 5), onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

/** Apply drizzle migrations, then (re)create the reporting views. */
export async function migrateDb(h: DbHandle): Promise<void> {
  await migrate(h.db, { migrationsFolder: MIGRATIONS_DIR });
  const views = fs.readFileSync(VIEWS_FILE, "utf8");
  for (const stmt of splitSql(views)) await h.db.execute(sql.raw(stmt));
}

/**
 * Wipe everything (schema `public` and drizzle's migration table). Only for throw-away databases:
 * refuses unless the database name contains "test" or "e2e".
 */
export async function resetDatabase(h: DbHandle): Promise<void> {
  const [{ name }] = await query<{ name: string }>(h.db, sql`SELECT current_database() AS name`);
  if (!/test|e2e/i.test(name)) throw new Error(`Refusing to reset database '${name}': its name must contain 'test' or 'e2e'.`);
  await h.db.execute(sql.raw("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"));
}

function splitSql(text: string): string[] {
  return text
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

/** Run raw SQL and return plain rows. */
export async function query<T = Record<string, unknown>>(db: DB, q: SQL): Promise<T[]> {
  const r = (await db.execute(q)) as unknown;
  if (Array.isArray(r)) return r as T[];
  return ((r as { rows?: T[] }).rows ?? []) as T[];
}

// ---------------------------------------------------------------- app singleton

const g = globalThis as unknown as { __kr_db?: DbHandle };

export function getDbHandle(): DbHandle {
  return (g.__kr_db ??= createDb());
}

export async function getDb(): Promise<DB> {
  return getDbHandle().db;
}
