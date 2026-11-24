"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp, KeyRound, LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { CommandMenu } from "./CommandMenu";
import { LogoMark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { TOUR_EVENT } from "./WelcomeTour";
import { sectionFor } from "./nav";

export function TopBar({ isStaff, isAdmin }: { isStaff: boolean; isAdmin: boolean }) {
  const path = usePathname();
  const { group, label } = sectionFor(path);
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-md supports-backdrop-filter:bg-background/70 md:px-4">
      <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
      <Link href="/today" className="md:hidden" aria-label="Knowledge Review home">
        <LogoMark className="size-7" />
      </Link>
      <Separator orientation="vertical" className="mx-1 hidden h-4 data-vertical:self-center md:block" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {group && (
            <>
              <BreadcrumbItem className="hidden sm:inline-flex">{group}</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:block" />
            </>
          )}
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate font-medium">{label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-1">
        <CommandMenu isStaff={isStaff} isAdmin={isAdmin} />
        <ThemeToggle />
        <Tooltip>
          <TooltipTrigger
            render={<Button type="button" variant="ghost" size="icon" className="text-success hover:text-success" aria-label="Take the tour" onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))} />}
          >
            <CircleHelp />
          </TooltipTrigger>
          <TooltipContent side="bottom">Take the tour</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Link href="/profile" aria-label="Profile and security" className={buttonVariants({ variant: "ghost", size: "icon" })} />}>
            <KeyRound />
          </TooltipTrigger>
          <TooltipContent side="bottom">Profile &amp; security</TooltipContent>
        </Tooltip>
        <form action={logoutAction}>
          <Tooltip>
            <TooltipTrigger render={<Button type="submit" variant="ghost" size="icon" aria-label="Sign out" />}>
              <LogOut />
            </TooltipTrigger>
            <TooltipContent side="bottom">Sign out</TooltipContent>
          </Tooltip>
        </form>
      </div>
    </header>
  );
}
