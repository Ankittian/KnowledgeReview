import type { Metadata } from "next";
import { APP_TZ } from "@/lib/dates";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { MessagesSquare, Search, ShieldAlert, SlidersHorizontal, ThumbsDown, ThumbsUp } from "lucide-react";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { Empty, TableCard, Tag, surface, tcell, thead } from "@/components/admin/bits";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { ANSWER_ROLES, KB_LABELS, KB_SOURCES, isKbSource, type AnswerRole } from "@/lib/chat/config";
import { adminListChats, BLOCKED_FILTERS, isBlockedFilter, type AdminChatFilter } from "@/lib/chat/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "All chats" };

const fmt = (d: Date | string) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: APP_TZ });
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** Admins see every conversation, filterable by user, role, date and feedback (REQ-CHAT-06, REQ-ROLE-05). */
export default async function AllChatsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const role = one(sp.role);
  const feedback = one(sp.feedback);
  const kb = one(sp.kb);
  const blocked = one(sp.blocked);
  const filter: AdminChatFilter = {
    q: one(sp.q)?.trim().slice(0, 100) || undefined,
    userId: one(sp.user),
    role: (ANSWER_ROLES as readonly string[]).includes(role ?? "") ? (role as AnswerRole) : undefined,
    kb: isKbSource(kb) ? kb : undefined,
    from: one(sp.from),
    to: one(sp.to),
    feedback: ["up", "down", "any", "none"].includes(feedback ?? "") ? (feedback as AdminChatFilter["feedback"]) : undefined,
    blocked: isBlockedFilter(blocked) ? blocked : undefined,
    includeDeleted: one(sp.deleted) === "1",
  };
  const db = await getDb();
  const [rows, people] = await Promise.all([
    adminListChats(db, filter),
    db.select({ id: users.id, displayName: users.displayName, username: users.username }).from(users).orderBy(asc(users.displayName)),
  ]);
  const totals = rows.reduce((a, r) => ({ questions: a.questions + r.questions, ups: a.ups + r.ups, downs: a.downs + r.downs, tokens: a.tokens + r.tokens }), { questions: 0, ups: 0, downs: 0, tokens: 0 });

  return (
    <div className="space-y-6">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground tabular-nums">{rows.length}</span> chats
        </span>
        <span>
          <span className="font-semibold text-foreground tabular-nums">{totals.questions}</span> questions
        </span>
        <span>
          <span className="font-semibold text-foreground tabular-nums">{totals.tokens.toLocaleString()}</span> tokens
        </span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <ThumbsUp className="size-3.5 text-success" /> {totals.ups}
          <ThumbsDown className="ml-2 size-3.5 text-destructive" /> {totals.downs}
        </span>
      </p>

      <form className={cn(surface, "grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-7")} method="get" role="search">
        <div className="sm:col-span-2 lg:col-span-7">
          <InputGroup className="h-10">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput name="q" defaultValue={filter.q ?? ""} placeholder="Search chats by title, question, answer or user…" aria-label="Search chats" maxLength={100} />
          </InputGroup>
        </div>
        <div className="grid gap-1.5 lg:col-span-2">
          <Label htmlFor="f-user">User</Label>
          <NativeSelect id="f-user" name="user" defaultValue={filter.userId ?? ""} className="w-full">
            <NativeSelectOption value="">Everyone</NativeSelectOption>
            {people.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.displayName} ({p.username})
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-kb">Knowledge base</Label>
          <NativeSelect id="f-kb" name="kb" defaultValue={filter.kb ?? ""} className="w-full">
            <NativeSelectOption value="">Any</NativeSelectOption>
            {KB_SOURCES.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {KB_LABELS[k]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-feedback">Feedback</Label>
          <NativeSelect id="f-feedback" name="feedback" defaultValue={filter.feedback ?? ""} className="w-full">
            <NativeSelectOption value="">Any</NativeSelectOption>
            <NativeSelectOption value="down">Has thumbs down</NativeSelectOption>
            <NativeSelectOption value="up">Has thumbs up</NativeSelectOption>
            <NativeSelectOption value="any">Has any feedback</NativeSelectOption>
            <NativeSelectOption value="none">No feedback</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-blocked">Blocked</Label>
          <NativeSelect id="f-blocked" name="blocked" defaultValue={filter.blocked ?? ""} className="w-full">
            <NativeSelectOption value="">Any</NativeSelectOption>
            <NativeSelectOption value="any">Any blocked</NativeSelectOption>
            {BLOCKED_FILTERS.map((b) => (
              <NativeSelectOption key={b} value={b}>
                {b.replace(/_/g, " ")}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-from">From</Label>
          <Input id="f-from" type="date" name="from" defaultValue={filter.from ?? ""} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-to">To</Label>
          <Input id="f-to" type="date" name="to" defaultValue={filter.to ?? ""} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t pt-3 sm:col-span-2 lg:col-span-7">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" name="deleted" value="1" defaultChecked={filter.includeDeleted} className="size-4 rounded border-input accent-primary" /> Include deleted chats
          </label>
          <div className="ml-auto flex gap-2">
            <Link href="/admin/chats" className={buttonVariants({ variant: "ghost" })}>
              Reset
            </Link>
            <button className={buttonVariants()}>
              <SlidersHorizontal /> Apply filters
            </button>
          </div>
        </div>
      </form>

      {rows.length === 0 ? (
        <Empty title="No chats match these filters" icon={<MessagesSquare />} />
      ) : (
        <TableCard>
          <Table className="min-w-[820px]" data-testid="all-chats">
            <TableHeader className={thead}>
              <TableRow className="hover:bg-transparent">
                <TableHead>Chat</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Answer style</TableHead>
                <TableHead>Knowledge base</TableHead>
                <TableHead className="text-right">Questions</TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1" aria-label="Thumbs up / down">
                    <ThumbsUp className="size-3.5" /> / <ThumbsDown className="size-3.5" />
                  </span>
                </TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className={cn(tcell, "max-w-xs")}>
                    <Link href={`/admin/chats/${r.id}`} className="font-medium hover:text-primary hover:underline">
                      {r.title}
                    </Link>
                    {r.deletedAt && (
                      <Tag tone="destructive" className="ml-2">
                        deleted
                      </Tag>
                    )}
                    {r.blocked > 0 && (
                      <Tag tone="destructive" className="ml-2 whitespace-nowrap" title={`Refused by the intent classifier: ${r.blockedCategories.map((c) => c.replace(/_/g, " ")).join(", ")}`}>
                        <ShieldAlert className="mr-1 inline size-3" />
                        {r.blocked} blocked
                      </Tag>
                    )}
                  </TableCell>
                  <TableCell className={tcell}>
                    <p className="font-medium">{r.displayName}</p>
                    <p className="text-xs text-muted-foreground">{r.username}</p>
                  </TableCell>
                  <TableCell className={tcell}>
                    <Tag tone="outline" className="capitalize">
                      {r.roleUsed}
                    </Tag>
                  </TableCell>
                  <TableCell className={tcell}>
                    <Tag tone={r.kbSource === "spectrumerp_new" ? "primary" : "neutral"} className="whitespace-nowrap">
                      {KB_LABELS[r.kbSource]}
                    </Tag>
                  </TableCell>
                  <TableCell className={cn(tcell, "text-right tabular-nums")}>{r.questions}</TableCell>
                  <TableCell className={cn(tcell, "text-right tabular-nums")}>
                    <span className="text-success">{r.ups}</span> <span className="text-muted-foreground/50">/</span> <span className="text-destructive">{r.downs}</span>
                  </TableCell>
                  <TableCell className={cn(tcell, "text-right font-mono text-xs tabular-nums")}>{r.tokens.toLocaleString()}</TableCell>
                  <TableCell className={cn(tcell, "text-xs whitespace-nowrap text-muted-foreground")}>{fmt(r.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </div>
  );
}
