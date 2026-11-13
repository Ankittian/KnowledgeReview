import { cookies } from "next/headers";
import type { SessionUser } from "@/lib/auth/session";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { MobileTabBar } from "./NavLinks";
import { TopBar } from "./TopBar";

export async function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const isStaff = user.role === "admin";
  const isAdmin = user.role === "admin";
  const initials = user.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar user={{ displayName: user.displayName, username: user.username, role: user.role, initials }} isStaff={isStaff} isAdmin={isAdmin} />
      <SidebarInset className="min-w-0">
        <TopBar isStaff={isStaff} isAdmin={isAdmin} />
        <div className="flex-1 pb-24 md:pb-10">{children}</div>
      </SidebarInset>
      <MobileTabBar isStaff={isStaff} />
    </SidebarProvider>
  );
}
