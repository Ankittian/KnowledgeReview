import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { Coins, Cpu, MessagesSquare, MessageCircleQuestion, SlidersHorizontal, ThumbsDown, ThumbsUp } from "lucide-react";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { Empty, TableCard, Tag, surface, tcell, thead } from "@/components/admin/bits";
import { Stagger, StaggerItem } from "@/components/common/motion";
import { StatCard } from "@/components/common/StatCard";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { ANSWER_ROLES, type AnswerRole } from "@/lib/chat/config";
import { queueStats } from "@/lib/chat/live";
import { adminListChats, type AdminChatFilter } from "@/lib/chat/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "All chats" };

const fmt = (d: Date | string) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** Admins see every conversation, filterable by user, role, date and feedback (REQ-CHAT-06, REQ-ROLE-05). */
export default async function AllChatsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const role = one(sp.role);
  const feedback = one(sp.feedback);
  const filter: AdminChatFilter = {
    userId: one(sp.user),
    role: (ANSWER_ROLES as readonly string[]).includes(role ?? "") ? (role as AnswerRole) : undefined,
    from: one(sp.from),
    to: one(sp.to),
    feedback: ["up", "down", "any", "none"].includes(feedback ?? "") ? (feedback as AdminChatFilter["feedback"]) : undefined,
    includeDeleted: one(sp.deleted) === "1",
  };
  const db = await getDb();
  const [rows, people] = await Promise.all([
    adminListChats(db, filter),
    db.select({ id: users.id, displayName: users.displayName, username: users.username }).from(users).orderBy(asc(users.displayName)),
  ]);
  const q = queueStats();
  const totals = rows.reduce((a, r) => ({ questions: a.questions + r.questions, ups: a.ups + r.ups, downs: a.downs + r.downs, tokens: a.tokens + r.tokens }), {
    questions: 0,
    ups: 0,
    downs: 0,
    tokens: 0,
  });

  return (
    <div className="space-y-6">
      <Stagger className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StaggerItem>
          <StatCard label="Chats shown" value={rows.length} icon={<MessagesSquare />} />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Questions" value={totals.questions} icon={<MessageCircleQuestion />} tone="primary" />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Thumbs up / down"
            value={`${totals.ups} / ${totals.downs}`}
            icon={<ThumbsUp />}
            tone="success"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Tokens" value={totals.tokens} icon={<Coins />} />
        </StaggerItem>
        <StaggerItem className="col-span-2 md:col-span-1">
          <StatCard label="Claude slots" value={`${q.running} / ${q.limit}`} sub={`${q.waiting} waiting`} icon={<Cpu />} tone={q.running >= q.limit ? "warning" : "default"} />
        </StaggerItem>
      </Stagger>

      <form className={cn(surface, "grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6")} method="get">
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
          <Label htmlFor="f-role">Role</Label>
          <NativeSelect id="f-role" name="role" defaultValue={filter.role ?? ""} className="w-full">
            <NativeSelectOption value="">Any</NativeSelectOption>
            {ANSWER_ROLES.map((r) => (
              <NativeSelectOption key={r} value={r} className="capitalize">
                {r}
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
          <Label htmlFor="f-from">From</Label>
          <Input id="f-from" type="date" name="from" defaultValue={filter.from ?? ""} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-to">To</Label>
          <Input id="f-to" type="date" name="to" defaultValue={filter.to ?? ""} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t pt-3 sm:col-span-2 lg:col-span-6">
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
          <Table className="min-w-[860px]" data-testid="all-chats">
            <TableHeader className={thead}>
              <TableRow className="hover:bg-transparent">
                <TableHead>Chat</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Questions</TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1" aria-label="Thumbs up / down">
                    <ThumbsUp className="size-3.5" /> / <ThumbsDown className="size-3.5" />
                  </span>
                </TableHead>
                <TableHead className="text-right">Errors</TableHead>
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
                  <TableCell className={cn(tcell, "text-right tabular-nums")}>{r.questions}</TableCell>
                  <TableCell className={cn(tcell, "text-right tabular-nums")}>
                    <span className="text-success">{r.ups}</span> <span className="text-muted-foreground/50">/</span> <span className="text-destructive">{r.downs}</span>
                  </TableCell>
                  <TableCell className={cn(tcell, "text-right tabular-nums", r.errors ? "font-medium text-warning" : "text-muted-foreground")}>{r.errors}</TableCell>
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
