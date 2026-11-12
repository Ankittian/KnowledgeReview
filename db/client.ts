import path from "node:path";
import fs from "node:fs";
import { sql, type SQL } from "drizzle-orm";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: DB;
  kind: "postgres" | "pglite";
  close: () => Promise<void>;
}

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");
const VIEWS_FILE = path.join(process.cwd(), "db", "views.sql");

/**
 * Managed Postgres when DATABASE_URL is set (Neon / Supabase), otherwise embedded PGlite on disk
 * (`PGLITE_DIR`, default ./.data/pglite) or in memory (`memory: true`, used by tests).
 */
export async function createDb(opts: { url?: string; memory?: boolean; dir?: string } = {}): Promise<DbHandle> {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url && !opts.memory) {
    const postgres = (await import("postgres")).default;
    // prepare:false keeps transaction-mode poolers (Supabase pgbouncer, Neon pooler) happy.
    const client = postgres(url, { prepare: false, max: Number(process.env.DB_POOL_MAX ?? 5), onnotice: () => {} });
    return { db: drizzlePg(client, { schema }), kind: "postgres", close: () => client.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  let client;
  if (opts.memory) {
    client = new PGlite();
  } else {
    const dir = opts.dir ?? process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    client = new PGlite(dir);
  }
  const { drizzle } = await import("drizzle-orm/pglite");
  const db = drizzle({ client, schema }) as unknown as DB;
  return { db, kind: "pglite", close: () => client.close() };
}

/** Apply drizzle migrations, then (re)create the reporting views. */
export async function migrateDb(h: DbHandle): Promise<void> {
  if (h.kind === "postgres") {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(h.db, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(h.db as any, { migrationsFolder: MIGRATIONS_DIR });
  }
  const views = fs.readFileSync(VIEWS_FILE, "utf8");
  for (const stmt of splitSql(views)) await h.db.execute(sql.raw(stmt));
}

function splitSql(text: string): string[] {
  return text
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

/** Run raw SQL and return plain rows, whichever driver is in use. */
export async function query<T = Record<string, unknown>>(db: DB, q: SQL): Promise<T[]> {
  const r = (await db.execute(q)) as unknown;
  if (Array.isArray(r)) return r as T[];
  return ((r as { rows?: T[] }).rows ?? []) as T[];
}

// ---------------------------------------------------------------- app singleton

const g = globalThis as unknown as { __kr_db?: Promise<DbHandle> };

export function getDbHandle(): Promise<DbHandle> {
  if (!g.__kr_db) {
    g.__kr_db = (async () => {
      const h = await createDb();
      // Embedded PGlite is single-process: make local dev zero-setup by migrating on first use.
      if (h.kind === "pglite") await migrateDb(h);
      return h;
    })();
  }
  return g.__kr_db;
}

export async function getDb(): Promise<DB> {
  return (await getDbHandle()).db;
}
