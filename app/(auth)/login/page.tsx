import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) redirect("/today");
  const { next } = await searchParams;
  return (
    <div className="panel p-6 shadow-card sm:p-8">
      <h1 className="text-xl font-semibold">Welcome back</h1>
      <p className="mt-1 text-sm text-muted">Sign in to review today’s flashcards.</p>
      <LoginForm next={next ?? ""} />
      <p className="mt-6 text-center text-sm text-muted">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-primary hover:underline">
          Request an account
        </Link>
      </p>
    </div>
  );
}
