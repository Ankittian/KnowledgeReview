"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
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
import { ForceLogo, LogoMark } from "./Logo";
import { MAIN_NAV, adminItems, isActive, type NavItem } from "./nav";

export function AppSidebar({ isStaff, isAdmin }: { isStaff: boolean; isAdmin: boolean }) {
  const path = usePathname();
  const { setOpenMobile } = useSidebar();

  const renderItems = (items: NavItem[]) =>
    items.map((i) => (
      <SidebarMenuItem key={i.href}>
        <SidebarMenuButton
          isActive={isActive(path, i.href)}
          className="data-active:text-success"
          tooltip={i.label}
          render={<Link href={i.href} data-tour={i.href} onClick={() => setOpenMobile(false)} aria-current={isActive(path, i.href) ? "page" : undefined} />}
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
            {/* expanded: wordmark linking to Chat */}
            <div className="flex px-2 py-1 group-data-[collapsible=icon]:hidden">
              <ForceLogo className="h-9" />
            </div>
            {/* collapsed: small mark linking to Chat */}
            <SidebarMenuButton size="lg" className="hidden justify-center gap-0 group-data-[collapsible=icon]:flex" render={<Link href="/chat" aria-label="Go to Chat" />}>
              <LogoMark className="size-8" />
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

      <SidebarRail />
    </Sidebar>
  );
}
