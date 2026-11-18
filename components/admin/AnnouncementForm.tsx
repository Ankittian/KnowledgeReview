"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ANNOUNCEMENT_MAX_LENGTH, type Announcement, type AnnouncementTone } from "@/lib/settings";

/** Publish / update / turn off the announcement banner. Shows a toast so a failed save is never silent. */
export function AnnouncementForm({ announcement, action }: { announcement: Announcement | null; action: (fd: FormData) => Promise<void> }) {
  const [message, setMessage] = useState(announcement?.message ?? "");
  const [tone, setTone] = useState<AnnouncementTone>(announcement?.tone ?? "info");
  const [pending, start] = useTransition();
  const live = announcement?.active === true;

  const submit = (intent: "publish" | "off") =>
    start(async () => {
      if (intent === "publish" && !message.trim()) {
        toast.error("Write a message first.");
        return;
      }
      const fd = new FormData();
      fd.set("message", message);
      fd.set("tone", tone);
      fd.set("intent", intent);
      try {
        await action(fd);
        toast.success(intent === "publish" ? "Announcement is live." : "Announcement turned off.");
      } catch (e) {
        console.error("saveAnnouncement failed", e);
        toast.error(`Couldn't save the announcement: ${e instanceof Error ? e.message : "unknown error"}`);
      }
    });

  return (
    <div className="mt-5 grid gap-3 border-t pt-4">
      <div className="grid gap-1.5">
        <Label htmlFor="announcement">Message</Label>
        <Textarea
          id="announcement"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={ANNOUNCEMENT_MAX_LENGTH}
          placeholder="e.g. Maintenance tonight at 10 pm. Cards will be unavailable for 15 minutes."
        />
        <span className="text-right text-xs text-muted-foreground tabular-nums">
          {message.length}/{ANNOUNCEMENT_MAX_LENGTH}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="announcementTone">Style</Label>
          <select
            id="announcementTone"
            value={tone}
            onChange={(e) => setTone(e.target.value as AnnouncementTone)}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="info">Info (blue)</option>
            <option value="success">Good news (green)</option>
            <option value="warning">Warning (amber)</option>
          </select>
        </div>
        <Button type="button" className="ml-auto" disabled={pending} onClick={() => submit("publish")} data-testid="publish-announcement">
          {pending && <Spinner />} {live ? "Update" : "Publish"}
        </Button>
        {live && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => submit("off")} data-testid="unpublish-announcement">
            Turn off
          </Button>
        )}
      </div>
    </div>
  );
}
