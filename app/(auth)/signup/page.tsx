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
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Request an account</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">An administrator approves new accounts before you can sign in.</p>
      <SignupForm modules={modules} />
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
