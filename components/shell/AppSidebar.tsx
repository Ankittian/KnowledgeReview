"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogoMark } from "./Logo";
import { MAIN_NAV, adminItems, isActive, type NavItem } from "./nav";

export interface ShellUser {
  displayName: string;
  username: string;
  role: string;
  initials: string;
}

export function AppSidebar({ user, isStaff, isAdmin }: { user: ShellUser; isStaff: boolean; isAdmin: boolean }) {
  const path = usePathname();
  const { setOpenMobile } = useSidebar();

  const renderItems = (items: NavItem[]) =>
    items.map((i) => (
      <SidebarMenuItem key={i.href}>
        <SidebarMenuButton
          isActive={isActive(path, i.href)}
          tooltip={i.label}
          render={<Link href={i.href} onClick={() => setOpenMobile(false)} aria-current={isActive(path, i.href) ? "page" : undefined} />}
        >
          <i.icon />
          <span>{i.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0" render={<Link href="/today" aria-label="Knowledge Review home" />}>
              <LogoMark className="size-8" />
              <span className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm font-semibold text-sidebar-accent-foreground">Knowledge Review</span>
                <span className="truncate text-xs text-muted-foreground">SpectrumERP</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(MAIN_NAV)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {isStaff && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(adminItems(isAdmin))}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2.5 rounded-md p-1.5 group-data-[collapsible=icon]:p-0" title={`${user.displayName} (${user.username})`}>
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-semibold text-primary">{user.initials}</AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm font-medium text-sidebar-accent-foreground">{user.displayName}</span>
                <span className="truncate text-xs text-muted-foreground capitalize">
                  {user.username} · {user.role}
                </span>
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
