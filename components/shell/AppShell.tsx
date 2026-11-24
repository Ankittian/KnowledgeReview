import { cookies } from "next/headers";
import type { SessionUser } from "@/lib/auth/session";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getDb } from "@/db/client";
import { getActiveAnnouncement } from "@/lib/settings";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { EmailBanner } from "./EmailBanner";
import { AppSidebar } from "./AppSidebar";
import { MobileTabBar } from "./NavLinks";
import { TopBar } from "./TopBar";
import { WelcomeTour } from "./WelcomeTour";

export async function AppShell({ user, needsEmail = false, children }: { user: SessionUser; needsEmail?: boolean; children: React.ReactNode }) {
  const isStaff = user.role === "admin";
  const isAdmin = user.role === "admin";
  const announcement = await getActiveAnnouncement(await getDb());
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar isStaff={isStaff} isAdmin={isAdmin} />
      <SidebarInset className="min-w-0">
        <TopBar isStaff={isStaff} isAdmin={isAdmin} />
        {announcement && <AnnouncementBanner announcement={announcement} />}
        {needsEmail && <EmailBanner />}
        <div className="flex-1 pb-24 md:pb-10">{children}</div>
      </SidebarInset>
      <MobileTabBar isStaff={isStaff} />
      <WelcomeTour userId={user.id} name={user.displayName} />
    </SidebarProvider>
  );
}
