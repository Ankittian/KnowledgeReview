import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Hourglass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Awaiting approval" };

export default async function PendingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { new: isNew } = await searchParams;
  return (
    <div className="text-center">
      <div className="relative mx-auto mb-6 flex size-14 items-center justify-center">
        <span aria-hidden className="absolute inset-0 animate-ping rounded-2xl bg-warning/15 [animation-duration:2.4s]" />
        <span className="relative flex size-14 items-center justify-center rounded-2xl bg-warning/12 text-warning ring-1 ring-warning/20">
          <Hourglass className="size-6" />
        </span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{isNew ? "Request sent" : "Awaiting approval"}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        {isNew ? "Your account was created. " : ""}An administrator needs to approve it before you can sign in. Check back soon.
      </p>
      <Link href="/login" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-8 h-10 w-full")}>
        <ArrowLeft /> Back to sign in
      </Link>
    </div>
  );
}
