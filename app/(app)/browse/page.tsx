import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Search } from "lucide-react";
import { getDb, query } from "@/db/client";
import { BrowseCard } from "@/components/browse/BrowseCard";
import { requireUser } from "@/lib/auth/session";
import { getModuleNames } from "@/lib/deck";

export const metadata: Metadata = { title: "Browse" };

const PAGE = 24;

export default async function BrowsePage({ searchParams }: { searchParams: Promise<{ q?: string; module?: string; page?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const module = (sp.module ?? "").trim().slice(0, 10);
  const page = Math.max(1, Number(sp.page) || 1);
  const db = await getDb();
  const moduleNames = await getModuleNames(db);

  const where = [sql`c.status = 'active'`];
  if (module) where.push(sql`c.module = ${module}`);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(cv.front ILIKE ${like} OR cv.back ILIKE ${like} OR cv.context ILIKE ${like})`);
  }
  const w = sql.join(where, sql` AND `);
  const [rows, [{ n }]] = await Promise.all([
    query<{ v: number; context: string; front: string; back: string; module: string | null }>(
      db,
      sql`SELECT cv.id AS v, cv.context, cv.front, cv.back, c.module
          FROM cards c JOIN card_versions cv ON cv.id = c.current_version_id
          WHERE ${w} ORDER BY cv.context, cv.front LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
    ),
    query<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM cards c JOIN card_versions cv ON cv.id = c.current_version_id WHERE ${w}`),
  ]);
  const pages = Math.max(1, Math.ceil(Number(n) / PAGE));
  const href = (p: number) => `/browse?${new URLSearchParams({ ...(q ? { q } : {}), ...(module ? { module } : {}), page: String(p) })}`;

  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 sm:pt-8">
      <h1 className="text-2xl font-bold tracking-tight">Browse cards</h1>
      <p className="mt-1 text-sm text-muted">Study freely. Browsing doesn’t affect your score.</p>
      <form className="mt-5 flex flex-col gap-2 sm:flex-row" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} className="input pl-10" placeholder="Search questions and answers…" aria-label="Search cards" />
        </div>
        <select name="module" defaultValue={module} className="input sm:w-56" aria-label="Area">
          <option value="">All areas</option>
          {[...moduleNames].map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary">Search</button>
      </form>
      <p className="mt-4 text-sm text-muted">
        {Number(n).toLocaleString()} card{Number(n) === 1 ? "" : "s"}
        {pages > 1 && ` · page ${page} of ${pages}`}
      </p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((c) => (
          <li key={c.v}>
            <BrowseCard card={{ ...c, module: c.module ? (moduleNames.get(c.module) ?? c.module) : null }} />
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-2" aria-label="Pagination">
          {page > 1 && (
            <Link className="btn btn-outline" href={href(page - 1)}>
              Previous
            </Link>
          )}
          {page < pages && (
            <Link className="btn btn-outline" href={href(page + 1)}>
              Next
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
