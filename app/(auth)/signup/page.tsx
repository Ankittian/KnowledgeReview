import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { kbEntities } from "@/db/schema";
import { SignupForm } from "@/components/auth/SignupForm";

export const metadata: Metadata = { title: "Request an account" };

export default async function SignupPage() {
  const db = await getDb();
  const modules = await db
    .select({ code: kbEntities.key, name: kbEntities.name })
    .from(kbEntities)
    .where(eq(kbEntities.type, "module"))
    .orderBy(kbEntities.name);
  return (
    <div className="panel p-6 shadow-card sm:p-8">
      <h1 className="text-xl font-semibold">Request an account</h1>
      <p className="mt-1 text-sm text-muted">An administrator approves new accounts before you can sign in.</p>
      <SignupForm modules={modules} />
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
