import type { Metadata } from "next";
import Link from "next/link";
import { Hourglass } from "lucide-react";

export const metadata: Metadata = { title: "Awaiting approval" };

export default async function PendingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { new: isNew } = await searchParams;
  return (
    <div className="panel p-6 text-center shadow-card sm:p-8">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-warning-soft text-warning">
        <Hourglass className="h-7 w-7" />
      </div>
      <h1 className="text-xl font-semibold">{isNew ? "Request sent" : "Awaiting approval"}</h1>
      <p className="mt-2 text-sm text-muted">
        {isNew ? "Your account was created. " : ""}An administrator needs to approve it before you can sign in. Check back soon.
      </p>
      <Link href="/login" className="btn btn-outline mt-6 w-full">
        Back to sign in
      </Link>
    </div>
  );
}
