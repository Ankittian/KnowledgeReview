"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCircle2, TriangleAlert, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { markNotificationsReadAction } from "@/app/actions/card-generation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Note {
  id: number;
  kind: string;
  jobId: number | null;
  message: string;
  read: boolean;
  createdAt: string;
}

const POLL_MS = 10_000;

const ICON: Record<string, typeof Bell> = { cards_ready: CheckCircle2, cards_pushed: UploadCloud, cards_failed: TriangleAlert };
const TONE: Record<string, string> = { cards_ready: "text-success", cards_pushed: "text-primary", cards_failed: "text-destructive" };

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/**
 * Bell in the top bar (admins). Polls /api/notifications every 10 seconds; a notification that arrives while the page
 * is open also shows as a toast with a link to the job, wherever the admin is in the app.
 */
export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const known = useRef<Set<number> | null>(null); // null until the first load, so old notifications do not pop up as toasts
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: Note[]; unread: number };
      if (known.current) {
        for (const n of data.items) {
          if (known.current.has(n.id) || n.read) continue;
          const go = () => router.push(n.jobId ? `/admin/cards/${n.jobId}` : "/admin/cards");
          if (n.kind === "cards_failed") toast.error(n.message, { action: { label: "Open", onClick: go } });
          else toast.success(n.message, { action: { label: n.kind === "cards_ready" ? "Review" : "Open", onClick: go } });
        }
      }
      known.current = new Set(data.items.map((n) => n.id));
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      /* offline: try again on the next tick */
    }
  }, [router]);

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const openNote = async (n: Note) => {
    setOpen(false);
    if (!n.read) {
      setItems((all) => all.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      void markNotificationsReadAction([n.id]);
    }
    router.push(n.jobId ? `/admin/cards/${n.jobId}` : "/admin/cards");
  };

  const markAll = async () => {
    setItems((all) => all.map((x) => ({ ...x, read: true })));
    setUnread(0);
    await markNotificationsReadAction();
  };

  return (
    <div ref={root} className="relative">
      <Button type="button" variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="bell">
        <Bell />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white" data-testid="bell-count">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-float ring-1 ring-foreground/10" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="text-xs font-medium text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing yet. You are told here when generated cards are ready.</li>}
            {items.map((n) => {
              const Icon = ICON[n.kind] ?? Bell;
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => openNote(n)} className={cn("flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left last:border-0 hover:bg-accent", !n.read && "bg-primary/5")}>
                    <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[n.kind])} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm text-pretty", !n.read && "font-medium")}>{n.message}</span>
                      <span className="text-xs text-muted-foreground">{ago(n.createdAt)}</span>
                    </span>
                    {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
