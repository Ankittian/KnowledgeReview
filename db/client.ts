import path from "node:path";
import fs from "node:fs";
import { sql, type SQL } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: DB;
  close: () => Promise<void>;
}

const SCHEMA_FILE = path.join(process.cwd(), "db", "schema.sql");
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
  // search_path lets raw SQL use bare table names (auth.*, kb.*, learning.* are all visible).
  const client = postgres(url, {
    prepare: false,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    onnotice: () => {},
    connection: { search_path: "public" },
  });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

/**
 * Prepares a database: creates every table from db/schema.sql when the database is empty (all in one transaction),
 * then (re)creates the reporting views from db/views.sql. Safe to run on every start: an existing database keeps its
 * tables and data and only gets its views refreshed. Returns whether the tables were created by this call.
 */
export async function applySchema(h: DbHandle): Promise<{ created: boolean }> {
  const [{ present }] = await query<{ present: boolean }>(h.db, sql`SELECT to_regclass('public.users') IS NOT NULL AS present`);
  if (!present) {
    const statements = splitSql(fs.readFileSync(SCHEMA_FILE, "utf8"));
    await h.db.transaction(async (tx) => {
      for (const stmt of statements) await tx.execute(sql.raw(stmt));
    });
  }
  for (const stmt of splitSql(fs.readFileSync(VIEWS_FILE, "utf8"))) await h.db.execute(sql.raw(stmt));
  return { created: !present };
}

/**
 * Wipe everything (the auth, kb, learning and public schemas). Only for throw-away databases:
 * refuses unless the database name contains "test" or "e2e".
 */
export async function resetDatabase(h: DbHandle): Promise<void> {
  const [{ name }] = await query<{ name: string }>(h.db, sql`SELECT current_database() AS name`);
  if (!/test|e2e/i.test(name)) throw new Error(`Refusing to reset database '${name}': its name must contain 'test' or 'e2e'.`);
  await h.db.execute(sql.raw("DROP SCHEMA IF EXISTS learning CASCADE; DROP SCHEMA IF EXISTS kb CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"));
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

// The pool is cached on globalThis so dev hot-reloads don't open a new one each time. Bump CLIENT_VERSION whenever the
// connection settings change (e.g. search_path), so a stale cached pool from before the change is replaced, not reused.
const CLIENT_VERSION = 3;
const g = globalThis as unknown as { __kr_db?: DbHandle & { v?: number } };

export function getDbHandle(): DbHandle {
  if (g.__kr_db && g.__kr_db.v !== CLIENT_VERSION) {
    void g.__kr_db.close().catch(() => {});
    g.__kr_db = undefined;
  }
  return (g.__kr_db ??= { ...createDb(), v: CLIENT_VERSION });
}

export async function getDb(): Promise<DB> {
  return getDbHandle().db;
}
