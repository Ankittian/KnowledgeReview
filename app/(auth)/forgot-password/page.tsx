import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage() {
  if (await getSession()) redirect("/profile");
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Enter your username or email and we will send you a code.</p>
      <ForgotPasswordForm />
      <p className="mt-8 text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
