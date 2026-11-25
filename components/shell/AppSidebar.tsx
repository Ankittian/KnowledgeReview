"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
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

  // The highlight behind the open page is one shared element: opening another page slides it from the old item to the new one.
  const renderItems = (items: NavItem[]) =>
    items.map((i) => {
      const active = isActive(path, i.href);
      return (
        <SidebarMenuItem key={i.href}>
          <SidebarMenuButton
            isActive={active}
            className="relative data-active:bg-transparent data-active:text-success"
            tooltip={i.label}
            render={<Link href={i.href} data-tour={i.href} onClick={() => setOpenMobile(false)} aria-current={active ? "page" : undefined} />}
          >
            {active && <motion.span layoutId="sidebar-active-pill" className="absolute inset-0 rounded-md bg-sidebar-accent" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            <i.icon className="relative" />
            <span className="relative">{i.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });

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
