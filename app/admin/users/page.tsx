import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { Check, Clock, UserCheck, UserX } from "lucide-react";
import { getDb } from "@/db/client";
import { userAnswerRoles, users } from "@/db/schema";
import { approveUser, setUserAnswerRole, setUserRole, setUserStatus } from "@/app/actions/admin";
import { DEFAULT_ANSWER_ROLE } from "@/lib/chat/config";
import { Empty, TableCard, Tag, surface, tcell, thead } from "@/components/admin/bits";
import { Stagger, StaggerItem } from "@/components/common/motion";
import { SectionTitle } from "@/components/common/PageHeader";
import { buttonVariants } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Users" };

const fmt = (d: Date | null) => (d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "–");
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function Initials({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary", className)} aria-hidden>
      {initials(name)}
    </span>
  );
}

export default async function UsersPage() {
  const { user: me } = await requireRole(["admin"]);
  const db = await getDb();
  const all = await db.select().from(users).orderBy(desc(users.createdAt));
  const answerRoles = new Map((await db.select().from(userAnswerRoles)).map((r) => [r.userId, r.answerRole]));
  const pending = all.filter((u) => u.status === "pending");
  const others = all.filter((u) => u.status !== "pending");

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle
          title={
            <span className="inline-flex items-center gap-2">
              Waiting for approval
              <Tag tone={pending.length ? "warning" : "neutral"} className="tabular-nums">
                {pending.length}
              </Tag>
            </span>
          }
        />
        {pending.length === 0 ? (
          <Empty title="No pending sign-ups" icon={<UserCheck />} />
        ) : (
          <Stagger as="ul" className="grid gap-3 md:grid-cols-2">
            {pending.map((u) => (
              <StaggerItem as="li" key={u.id} className={cn(surface, "p-4")} data-testid="pending-user">
                <div className="flex items-start gap-3">
                  <Initials name={u.displayName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{u.displayName}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {u.username}
                      {u.department ? ` · ${u.department}` : ""}
                      {u.primaryModule ? ` · ${u.primaryModule}` : ""}
                    </p>
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="size-3" /> Requested {fmt(u.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
                  <form action={approveUser} className="flex flex-1 gap-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <NativeSelect name="role" defaultValue="employee" aria-label="Role" className="w-32">
                      <NativeSelectOption value="employee">Employee</NativeSelectOption>
                      <NativeSelectOption value="reviewer">Reviewer</NativeSelectOption>
                      <NativeSelectOption value="admin">Admin</NativeSelectOption>
                    </NativeSelect>
                    <button className={cn(buttonVariants(), "flex-1 bg-success/10 text-success hover:bg-success/20")} data-testid="approve">
                      <Check /> Approve
                    </button>
                  </form>
                  <form action={setUserStatus}>
                    <input type="hidden" name="userId" value={u.id} />
                    <button name="status" value="disabled" className={buttonVariants({ variant: "destructive" })}>
                      <UserX /> Reject
                    </button>
                  </form>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </section>

      <section>
        <SectionTitle title="All users" description={`${others.length} account${others.length === 1 ? "" : "s"}`} />
        <TableCard>
          <Table className="min-w-[900px]">
            <TableHeader className={thead}>
              <TableRow className="hover:bg-transparent">
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead title="How the assistant writes answers for this user. Admins choose per chat.">Answer style</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {others.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className={tcell}>
                    <div className="flex items-center gap-2.5">
                      <Initials name={u.displayName} className="size-8" />
                      <div className="min-w-0">
                        <p className="font-medium">
                          {u.displayName}
                          {u.id === me.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {u.username}
                          {u.department ? ` · ${u.department}` : ""}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={cn(tcell, "align-middle")}>
                    {u.id === me.id ? (
                      <Tag tone="primary" className="capitalize">
                        {u.role}
                      </Tag>
                    ) : (
                      <form action={setUserRole} className="flex gap-1.5">
                        <input type="hidden" name="userId" value={u.id} />
                        <NativeSelect name="role" defaultValue={u.role} size="sm" className="w-28" aria-label={`Role for ${u.username}`}>
                          <NativeSelectOption value="employee">Employee</NativeSelectOption>
                          <NativeSelectOption value="reviewer">Reviewer</NativeSelectOption>
                          <NativeSelectOption value="admin">Admin</NativeSelectOption>
                        </NativeSelect>
                        <button className={buttonVariants({ variant: "outline", size: "sm" })}>Save</button>
                      </form>
                    )}
                  </TableCell>
                  <TableCell className={cn(tcell, "align-middle")}>
                    {u.role === "admin" ? (
                      <span className="text-xs text-muted-foreground">Chosen per chat</span>
                    ) : (
                      <form action={setUserAnswerRole} className="flex gap-1.5">
                        <input type="hidden" name="userId" value={u.id} />
                        <NativeSelect
                          name="answerRole"
                          defaultValue={answerRoles.get(u.id) ?? DEFAULT_ANSWER_ROLE}
                          size="sm"
                          className="w-28"
                          aria-label={`Answer style for ${u.username}`}
                          data-testid="answer-role"
                        >
                          <NativeSelectOption value="technical">Technical</NativeSelectOption>
                          <NativeSelectOption value="functional">Functional</NativeSelectOption>
                          <NativeSelectOption value="product">Product</NativeSelectOption>
                        </NativeSelect>
                        <button className={buttonVariants({ variant: "outline", size: "sm" })}>Save</button>
                      </form>
                    )}
                  </TableCell>
                  <TableCell className={cn(tcell, "align-middle")}>
                    <Tag tone={u.status === "active" ? "success" : "destructive"} className="capitalize">
                      <span className={cn("size-1.5 rounded-full", u.status === "active" ? "bg-success" : "bg-destructive")} />
                      {u.status}
                    </Tag>
                  </TableCell>
                  <TableCell className={cn(tcell, "align-middle text-xs text-muted-foreground")}>{fmt(u.lastLoginAt)}</TableCell>
                  <TableCell className={cn(tcell, "align-middle text-right")}>
                    {u.id !== me.id && (
                      <form action={setUserStatus}>
                        <input type="hidden" name="userId" value={u.id} />
                        <button
                          name="status"
                          value={u.status === "active" ? "disabled" : "active"}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), u.status === "active" ? "text-destructive hover:bg-destructive/10 hover:text-destructive" : "text-success hover:bg-success/10 hover:text-success")}
                        >
                          {u.status === "active" ? "Disable" : "Enable"}
                        </button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </section>
    </div>
  );
}
