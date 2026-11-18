"use client";

import { useEffect, useState } from "react";
import { Info, Megaphone, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Announcement } from "@/lib/settings";

const TONES = {
  info: { cls: "border-info/30 bg-info/10 text-info", icon: Info },
  success: { cls: "border-success/30 bg-success/10 text-success", icon: Megaphone },
  warning: { cls: "border-warning/30 bg-warning/12 text-warning", icon: TriangleAlert },
} as const;

const KEY = "announcement_dismissed";

/** Admin announcement, shown above the page. Employees can dismiss it; a new announcement shows again. */
export function AnnouncementBanner({ announcement }: { announcement: Announcement }) {
  const [hidden, setHidden] = useState(true); // hidden until we know it was not dismissed (avoids a flash)
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(KEY) === announcement.id);
    } catch {
      setHidden(false);
    }
  }, [announcement.id]);
  if (hidden) return null;

  const { cls, icon: Icon } = TONES[announcement.tone];
  return (
    <div role="status" data-testid="announcement-banner" className={cn("flex items-start gap-2.5 border-b px-4 py-2.5 text-sm sm:px-6", cls)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1 text-pretty whitespace-pre-line text-foreground">{announcement.message}</p>
      <button
        type="button"
        aria-label="Dismiss announcement"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(KEY, announcement.id);
          } catch {}
        }}
        className="-mr-1 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
