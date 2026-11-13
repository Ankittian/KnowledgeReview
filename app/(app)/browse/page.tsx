import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { ChevronLeft, ChevronRight, SearchX, Search } from "lucide-react";
import { getDb, query } from "@/db/client";
import { BrowseCard } from "@/components/browse/BrowseCard";
import { Stagger, StaggerItem } from "@/components/common/motion";
import { PageHeader } from "@/components/common/PageHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { requireUser } from "@/lib/auth/session";
import { audienceIn, pickAudiences } from "@/lib/cards/audience";
import { LEVELS, countWords, minReadSeconds, type Level } from "@/lib/cards/spec";
import { getModuleNames } from "@/lib/deck";
import { cn } from "@/lib/utils";

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
    <div className="mx-auto max-w-6xl space-y-5 px-4 pt-6 sm:px-6 sm:pt-8">
      <PageHeader title="Browse cards" description="Study freely. Browsing doesn’t affect your score." />

      <form className="flex flex-col gap-2 rounded-xl bg-card p-2 shadow-card ring-1 ring-foreground/[0.07] sm:flex-row" role="search">
        <InputGroup className="h-9 flex-1 border-transparent shadow-none dark:bg-transparent">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput name="q" defaultValue={q} placeholder="Search questions and answers…" aria-label="Search cards" />
        </InputGroup>
        <NativeSelect name="module" defaultValue={module} className="w-full sm:w-56 [&_select]:h-9" aria-label="Area">
          <NativeSelectOption value="">All areas</NativeSelectOption>
          {[...moduleNames].map(([code, name]) => (
            <NativeSelectOption key={code} value={code}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="level" defaultValue={level} className="w-full sm:w-40 [&_select]:h-9" aria-label="Level">
          <NativeSelectOption value="">All levels</NativeSelectOption>
          <NativeSelectOption value="easy">Easy (1)</NativeSelectOption>
          <NativeSelectOption value="medium">Medium (3)</NativeSelectOption>
          <NativeSelectOption value="hard">Hard (5)</NativeSelectOption>
        </NativeSelect>
        {user.role === "admin" && (
          <NativeSelect name="audience" defaultValue={sp.audience ?? ""} className="w-full sm:w-44 [&_select]:h-9" aria-label="Card set">
            <NativeSelectOption value="">Both sets</NativeSelectOption>
            <NativeSelectOption value="functional">Functional set</NativeSelectOption>
            <NativeSelectOption value="technical">Technical set</NativeSelectOption>
          </NativeSelect>
        )}
        <Button type="submit" className="h-9 px-4">
          Search
        </Button>
      </form>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground tabular-nums">{Number(n).toLocaleString()}</span> card{Number(n) === 1 ? "" : "s"}
          {q && (
            <>
              {" "}
              matching <span className="font-medium text-foreground">“{q}”</span>
            </>
          )}
        </p>
        {pages > 1 && (
          <p className="tabular-nums">
            Page {page} of {pages}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty className="rounded-xl border border-dashed py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>No cards found</EmptyTitle>
            <EmptyDescription>Try a different search term or pick another area.</EmptyDescription>
          </EmptyHeader>
          {(q || module) && (
            <Link href="/browse" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Clear filters
            </Link>
          )}
        </Empty>
      ) : (
        <Stagger as="ul" key={`${q}|${module}|${page}`} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => (
            <StaggerItem as="li" key={c.v}>
              <BrowseCard
                card={{
                  ...c,
                  module: c.module ? (moduleNames.get(c.module) ?? c.module) : null,
                  statement: true,
                  weight: c.level ? LEVELS[c.level].weight : 0,
                  minRead: minReadSeconds(countWords(c.back)),
                }}
              />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-center gap-2 pt-2" aria-label="Pagination">
          <Link
            className={cn(buttonVariants({ variant: "outline" }), page <= 1 && "pointer-events-none opacity-40")}
            href={href(Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            tabIndex={page <= 1 ? -1 : undefined}
          >
            <ChevronLeft /> Previous
          </Link>
          <span className="px-3 font-mono text-xs text-muted-foreground tabular-nums">
            {page} / {pages}
          </span>
          <Link
            className={cn(buttonVariants({ variant: "outline" }), page >= pages && "pointer-events-none opacity-40")}
            href={href(Math.min(pages, page + 1))}
            aria-disabled={page >= pages}
            tabIndex={page >= pages ? -1 : undefined}
          >
            Next <ChevronRight />
          </Link>
        </nav>
      )}
    </div>
  );
}
