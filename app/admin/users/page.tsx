import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { Check, UserX } from "lucide-react";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { approveUser, setUserRole, setUserStatus } from "@/app/actions/admin";
import { Empty } from "@/components/admin/bits";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Users" };

const fmt = (d: Date | null) => (d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "–");

export default async function UsersPage() {
  const { user: me } = await requireRole(["admin"]);
  const db = await getDb();
  const all = await db.select().from(users).orderBy(desc(users.createdAt));
  const pending = all.filter((u) => u.status === "pending");
  const others = all.filter((u) => u.status !== "pending");

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Waiting for approval <span className="chip ml-1">{pending.length}</span>
        </h2>
        {pending.length === 0 ? (
          <Empty title="No pending sign-ups" />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {pending.map((u) => (
              <li key={u.id} className="panel p-4" data-testid="pending-user">
                <p className="font-semibold">{u.displayName}</p>
                <p className="text-sm text-muted">
                  {u.username}
                  {u.department ? ` · ${u.department}` : ""}
                  {u.primaryModule ? ` · ${u.primaryModule}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted">Requested {fmt(u.createdAt)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={approveUser} className="flex flex-1 gap-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <select name="role" className="input w-auto py-2 text-sm" defaultValue="employee" aria-label="Role">
                      <option value="employee">Employee</option>
                      <option value="reviewer">Reviewer</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button className="btn btn-success flex-1 py-2" data-testid="approve">
                      <Check className="h-4 w-4" /> Approve
                    </button>
                  </form>
                  <form action={setUserStatus}>
                    <input type="hidden" name="userId" value={u.id} />
                    <button name="status" value="disabled" className="btn btn-danger py-2">
                      <UserX className="h-4 w-4" /> Reject
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">All users</h2>
        <div className="panel overflow-x-auto">
          <table className="tbl min-w-[720px]">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {others.map((u) => (
                <tr key={u.id}>
                  <td>
                    <p className="font-semibold">{u.displayName}</p>
                    <p className="text-xs text-muted">
                      {u.username}
                      {u.department ? ` · ${u.department}` : ""}
                    </p>
                  </td>
                  <td>
                    {u.id === me.id ? (
                      <span className="chip capitalize">{u.role}</span>
                    ) : (
                      <form action={setUserRole} className="flex gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        <select name="role" defaultValue={u.role} className="input w-auto py-1.5 text-sm" aria-label={`Role for ${u.username}`}>
                          <option value="employee">Employee</option>
                          <option value="reviewer">Reviewer</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button className="btn btn-outline py-1.5 text-xs">Save</button>
                      </form>
                    )}
                  </td>
                  <td>
                    <span className={`chip capitalize ${u.status === "active" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{u.status}</span>
                  </td>
                  <td className="text-xs text-muted">{fmt(u.lastLoginAt)}</td>
                  <td className="text-right">
                    {u.id !== me.id && (
                      <form action={setUserStatus}>
                        <input type="hidden" name="userId" value={u.id} />
                        <button name="status" value={u.status === "active" ? "disabled" : "active"} className="btn btn-ghost py-1.5 text-xs">
                          {u.status === "active" ? "Disable" : "Enable"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
