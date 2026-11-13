import { AppShell } from "@/components/shell/AppShell";
import { AdminHeader, AdminNav } from "@/components/admin/AdminNav";
import { requireRole } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRole(["admin"]);
  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">
        <AdminHeader />
        <div className="mt-5">
          <AdminNav isAdmin={user.role === "admin"} />
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </AppShell>
  );
}
