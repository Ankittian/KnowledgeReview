"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Monitor, Moon, Plus, Search, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { MAIN_NAV, adminItems } from "./nav";

/** ⌘K / Ctrl+K palette: jump to any page, start a chat, switch theme. */
export function CommandMenu({ isStaff, isAdmin }: { isStaff: boolean; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <Button
        variant="outline"
        className="hidden h-8 w-56 justify-start gap-2 rounded-lg bg-background px-2.5 font-normal text-muted-foreground shadow-none sm:inline-flex lg:w-64"
        onClick={() => setOpen(true)}
      >
        <Search />
        <span className="flex-1 text-left">Search or jump to…</span>
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Button>
      <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setOpen(true)} aria-label="Search or jump to">
        <Search />
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen} title="Command menu" description="Jump to a page or run a command">
        <Command>
          <CommandInput placeholder="Type a command or search…" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Workspace">
              {MAIN_NAV.map((i) => (
                <CommandItem key={i.href} value={`${i.label} ${i.description ?? ""}`} onSelect={() => run(() => router.push(i.href))}>
                  <i.icon />
                  <span>{i.label}</span>
                  <span className="ml-2 truncate text-xs text-muted-foreground">{i.description}</span>
                </CommandItem>
              ))}
              <CommandItem value="new chat ask assistant" onSelect={() => run(() => router.push("/chat"))}>
                <Plus />
                <span>New chat</span>
              </CommandItem>
            </CommandGroup>
            {isStaff && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Administration">
                  {adminItems(isAdmin).map((i) => (
                    <CommandItem key={i.href} value={`admin ${i.label} ${i.description ?? ""}`} onSelect={() => run(() => router.push(i.href))}>
                      <i.icon />
                      <span>{i.label}</span>
                      <span className="ml-2 truncate text-xs text-muted-foreground">{i.description}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            <CommandSeparator />
            <CommandGroup heading="Appearance">
              <CommandItem value="theme light" onSelect={() => run(() => setTheme("light"))}>
                <Sun /> Light theme
              </CommandItem>
              <CommandItem value="theme dark" onSelect={() => run(() => setTheme("dark"))}>
                <Moon /> Dark theme
              </CommandItem>
              <CommandItem value="theme system" onSelect={() => run(() => setTheme("system"))}>
                <Monitor /> System theme
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
