import { AppShell } from "@/components/shell/AppShell";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireRole } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRole(["admin", "reviewer"]);
  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:pt-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-wider text-muted uppercase">Administration</p>
            <h1 className="text-2xl font-bold tracking-tight">Knowledge health</h1>
          </div>
        </div>
        <AdminNav isAdmin={user.role === "admin"} />
        <div className="mt-6">{children}</div>
      </div>
    </AppShell>
  );
}
