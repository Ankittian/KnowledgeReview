import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { ChevronLeft, ChevronRight, SearchX, Search } from "lucide-react";
import { getDb, query } from "@/db/client";
import { BrowseGrid } from "@/components/browse/BrowseCard";
import { ModuleFormSelects } from "@/components/browse/ModuleFormSelects";
import { PageHeader } from "@/components/common/PageHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { requireUser } from "@/lib/auth/session";
import { audienceIn, canSwitchSets, pickAudiences } from "@/lib/cards/audience";
import { LEVELS, countWords, minReadSeconds, type Level } from "@/lib/cards/spec";
import { getModuleNames } from "@/lib/deck";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Browse" };

const PAGE = 24;

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; module?: string; page?: string; level?: string; audience?: string; form?: string }>;
}) {
  const { user } = await requireUser();
  const sp = await searchParams;
  const audiences = pickAudiences(user.role, sp.audience);
  const level = (Object.keys(LEVELS) as Level[]).find((l) => l === sp.level) ?? "";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const module = (sp.module ?? "").trim().slice(0, 10);
  const rawFormId = Number(sp.form) > 0 ? Number(sp.form) : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const db = await getDb();
  const moduleNames = await getModuleNames(db);

  // forms that have at least one card in this user's set: a card belongs to a form if it sits on the form or is related to it
  const forms = await query<{ id: number; name: string; n: number; module: string | null }>(
    db,
    sql`SELECT i.id, i.name, i.module, count(DISTINCT x.card_id)::int AS n
        FROM kb_items i JOIN (
          SELECT c.id AS card_id, c.kb_item_id AS form_id FROM cards c
            WHERE c.status = 'active' AND ${audienceIn(sql`c.audience`, audiences)}
          UNION ALL
          SELECT r.card_id, r.kb_item_id AS form_id FROM card_related_items r JOIN cards c ON c.id = r.card_id
            WHERE c.status = 'active' AND ${audienceIn(sql`c.audience`, audiences)}
        ) x ON x.form_id = i.id
        WHERE i.type = 'form' AND i.active
        GROUP BY i.id, i.name, i.module ORDER BY i.name`,
  );

  // a form only counts when it belongs to the chosen area (stale links / changed area)
  const formId = rawFormId && forms.some((f) => f.id === rawFormId && (!module || f.module === module)) ? rawFormId : null;

  // only generated cards in the user's own set (legacy template cards have no audience and are never listed)
  const where = [sql`c.status = 'active'`, audienceIn(sql`c.audience`, audiences)];
  if (level) where.push(sql`c.level::text = ${level}`);
  if (module) where.push(sql`i.module = ${module}`);
  if (formId) where.push(sql`(c.kb_item_id = ${formId} OR c.id IN (SELECT card_id FROM card_related_items WHERE kb_item_id = ${formId}))`);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(cv.front ILIKE ${like} OR cv.back ILIKE ${like} OR cv.context ILIKE ${like})`);
  }
  const w = sql.join(where, sql` AND `);
  const [rows, [{ n }]] = await Promise.all([
    query<{ v: number; context: string; front: string; back: string; module: string | null; level: Level | null; viewed: boolean }>(
      db,
      sql`SELECT cv.id AS v, cv.context, cv.front, cv.back, i.module, c.level,
                 EXISTS (SELECT 1 FROM card_reviews rv JOIN card_versions rcv ON rcv.id = rv.card_version_id WHERE rv.user_id = ${user.id} AND rcv.card_id = c.id) AS viewed
          FROM cards c JOIN kb_items i ON i.id = c.kb_item_id JOIN card_versions cv ON cv.id = c.current_version_id
          WHERE ${w} ORDER BY cv.context, array_position(ARRAY['easy','medium','hard'], c.level::text), cv.front LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
    ),
    query<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM cards c JOIN kb_items i ON i.id = c.kb_item_id JOIN card_versions cv ON cv.id = c.current_version_id WHERE ${w}`),
  ]);
  const pages = Math.max(1, Math.ceil(Number(n) / PAGE));
  const href = (p: number) =>
    `/browse?${new URLSearchParams({ ...(q ? { q } : {}), ...(module ? { module } : {}), ...(formId ? { form: String(formId) } : {}), ...(level ? { level } : {}), ...(sp.audience && canSwitchSets(user.role) ? { audience: sp.audience } : {}), page: String(p) })}`;

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 pt-6 sm:px-6 sm:pt-8">
      <PageHeader title="Browse cards" description="Answer a card to earn its points on the leaderboard. Each card scores once." />

      <form className="flex flex-col gap-2 rounded-xl bg-card p-2 shadow-card ring-1 ring-foreground/[0.07] sm:flex-row" role="search">
        <InputGroup className="h-9 flex-1 border-transparent shadow-none dark:bg-transparent">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput name="q" defaultValue={q} placeholder="Search questions and answers…" aria-label="Search cards" />
        </InputGroup>
        <ModuleFormSelects
          modules={[...moduleNames].map(([code, name]) => ({ code, name }))}
          forms={forms}
          initialModule={module}
          initialForm={formId ? String(formId) : ""}
        />
        <NativeSelect name="level" defaultValue={level} className="w-full sm:w-40 [&_select]:h-9" aria-label="Level">
          <NativeSelectOption value="">All levels</NativeSelectOption>
          <NativeSelectOption value="easy">Easy (1)</NativeSelectOption>
          <NativeSelectOption value="medium">Medium (2)</NativeSelectOption>
          <NativeSelectOption value="hard">Hard (3)</NativeSelectOption>
        </NativeSelect>
        {canSwitchSets(user.role) && (
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
          {(q || module || formId) && (
            <Link href="/browse" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Clear filters
            </Link>
          )}
        </Empty>
      ) : (
        <BrowseGrid
          key={`${q}|${module}|${formId ?? ""}|${level}|${sp.audience ?? ""}|${page}`}
          cards={rows.map((c) => ({
            ...c,
            module: c.module ? (moduleNames.get(c.module) ?? c.module) : null,
            statement: true,
            weight: c.level ? LEVELS[c.level].weight : 0,
            minRead: minReadSeconds(countWords(c.back)),
            viewed: c.viewed,
          }))}
        />
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
