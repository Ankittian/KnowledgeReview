import { eq } from "drizzle-orm";
import { AppShell } from "@/components/shell/AppShell";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  const [row] = await (await getDb()).select({ verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, user.id));
  return (
    <AppShell user={user} needsEmail={!row?.verifiedAt}>
      {children}
    </AppShell>
  );
}
