import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Search } from "lucide-react";
import { getDb, query } from "@/db/client";
import { BrowseCard } from "@/components/browse/BrowseCard";
import { requireUser } from "@/lib/auth/session";
import { audienceIn, pickAudiences } from "@/lib/cards/audience";
import { LEVELS, countWords, minReadSeconds, type Level } from "@/lib/cards/spec";
import { getModuleNames } from "@/lib/deck";

export const metadata: Metadata = { title: "Browse" };

const PAGE = 24;

export default async function BrowsePage({ searchParams }: { searchParams: Promise<{ q?: string; module?: string; page?: string; level?: string; audience?: string }> }) {
  const { user } = await requireUser();
  const sp = await searchParams;
  const audiences = pickAudiences(user.role, sp.audience);
  const level = (Object.keys(LEVELS) as Level[]).find((l) => l === sp.level) ?? "";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const module = (sp.module ?? "").trim().slice(0, 10);
  const page = Math.max(1, Number(sp.page) || 1);
  const db = await getDb();
  const moduleNames = await getModuleNames(db);

  // only generated cards in the user's own set (legacy template cards have no audience and are never listed)
  const where = [sql`c.status = 'active'`, audienceIn(sql`c.audience`, audiences)];
  if (level) where.push(sql`c.level::text = ${level}`);
  if (module) where.push(sql`i.module = ${module}`);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(cv.front ILIKE ${like} OR cv.back ILIKE ${like} OR cv.context ILIKE ${like})`);
  }
  const w = sql.join(where, sql` AND `);
  const [rows, [{ n }]] = await Promise.all([
    query<{ v: number; context: string; front: string; back: string; module: string | null; level: Level | null }>(
      db,
      sql`SELECT cv.id AS v, cv.context, cv.front, cv.back, i.module, c.level
          FROM cards c JOIN kb_items i ON i.id = c.kb_item_id JOIN card_versions cv ON cv.id = c.current_version_id
          WHERE ${w} ORDER BY cv.context, array_position(ARRAY['easy','medium','hard'], c.level::text), cv.front LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
    ),
    query<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM cards c JOIN kb_items i ON i.id = c.kb_item_id JOIN card_versions cv ON cv.id = c.current_version_id WHERE ${w}`),
  ]);
  const pages = Math.max(1, Math.ceil(Number(n) / PAGE));
  const href = (p: number) =>
    `/browse?${new URLSearchParams({ ...(q ? { q } : {}), ...(module ? { module } : {}), ...(level ? { level } : {}), ...(sp.audience && user.role === "admin" ? { audience: sp.audience } : {}), page: String(p) })}`;

  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 sm:pt-8">
      <h1 className="text-2xl font-bold tracking-tight">Browse cards</h1>
      <p className="mt-1 text-sm text-muted">Study freely. Browsing doesn’t affect your score.</p>
      <form className="mt-5 flex flex-col gap-2 sm:flex-row" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} className="input pl-10" placeholder="Search cards…" aria-label="Search cards" />
        </div>
        <select name="module" defaultValue={module} className="input sm:w-56" aria-label="Area">
          <option value="">All areas</option>
          {[...moduleNames].map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        <select name="level" defaultValue={level} className="input sm:w-40" aria-label="Level">
          <option value="">All levels</option>
          <option value="easy">Easy (1)</option>
          <option value="medium">Medium (3)</option>
          <option value="hard">Hard (5)</option>
        </select>
        {user.role === "admin" && (
          <select name="audience" defaultValue={sp.audience ?? ""} className="input sm:w-44" aria-label="Card set">
            <option value="">Both sets</option>
            <option value="functional">Functional set</option>
            <option value="technical">Technical set</option>
          </select>
        )}
        <button className="btn btn-primary">Search</button>
      </form>
      <p className="mt-4 text-sm text-muted">
        {Number(n).toLocaleString()} card{Number(n) === 1 ? "" : "s"}
        {pages > 1 && ` · page ${page} of ${pages}`}
      </p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((c) => (
          <li key={c.v}>
            <BrowseCard
              card={{
                ...c,
                module: c.module ? (moduleNames.get(c.module) ?? c.module) : null,
                statement: true,
                weight: c.level ? LEVELS[c.level].weight : 0,
                minRead: minReadSeconds(countWords(c.back)),
              }}
            />
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
