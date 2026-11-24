"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mail, X } from "lucide-react";

const KEY = "email_banner_dismissed";

/** Nudge for accounts without a verified email: it is needed to sign in with email and to recover a forgotten password. */
export function EmailBanner() {
  const path = usePathname();
  const [hidden, setHidden] = useState(true); // hidden until we know it was not dismissed (avoids a flash)
  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem(KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (hidden || path.startsWith("/profile")) return null;
  return (
    <div role="status" data-testid="email-banner" className="flex items-start gap-2.5 border-b border-info/30 bg-info/10 px-4 py-2.5 text-sm sm:px-6">
      <Mail className="mt-0.5 size-4 shrink-0 text-info" />
      <p className="min-w-0 flex-1 text-pretty">
        Add an email to your account so you can recover your password if you forget it.{" "}
        <Link href="/profile" className="font-medium underline underline-offset-4">
          Add email
        </Link>
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setHidden(true);
          try {
            sessionStorage.setItem(KEY, "1");
          } catch {}
        }}
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
