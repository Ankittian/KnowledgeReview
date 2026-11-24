import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { PageHeader } from "@/components/common/PageHeader";
import { EmailCard } from "@/components/profile/EmailCard";
import { PasswordCard } from "@/components/profile/PasswordCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { user } = await requireUser();
  const [row] = await (await getDb()).select({ email: users.email, verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, user.id));
  const email = row?.email && row.verifiedAt ? row.email : null;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title="Profile" description={`Signed in as ${user.displayName} (${user.username}).`} />
      <Card>
        <CardHeader>
          <CardTitle>Email</CardTitle>
          <CardDescription>{email ? "Sign in with your username or this email, and recover your password by email." : "Add an email to sign in with it and to recover your password if you forget it."}</CardDescription>
        </CardHeader>
        <CardContent>
          <EmailCard email={email} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Change it with your current password, or with a code emailed to you.</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordCard email={email} />
        </CardContent>
      </Card>
    </div>
  );
}
