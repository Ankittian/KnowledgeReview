"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme = "system", setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? theme : "system";
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Theme: ${current}`} />}>
        <Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={current} onValueChange={(v) => setTheme(String(v))}>
            {OPTIONS.map(({ value, label, icon: I }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <I className="text-muted-foreground" />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
