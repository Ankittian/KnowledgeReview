import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { GraduationCap, Users } from "lucide-react";
import { getDb, query } from "@/db/client";
import { SideTabs } from "@/components/admin/SideTabs";
import { AccountsTab } from "@/components/admin/people/AccountsTab";
import { KnowledgeTab } from "@/components/admin/people/KnowledgeTab";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "People" };

const TABS = ["accounts", "knowledge"] as const;
type Tab = (typeof TABS)[number];

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireRole(["admin"]);
  const { tab: raw } = await searchParams;
  const tab: Tab = TABS.find((t) => t === raw) ?? "accounts";
  const [{ n: pending }] = await query<{ n: number }>(await getDb(), sql`SELECT count(*)::int AS n FROM users WHERE status = 'pending'`);

  return (
    <SideTabs
      title="People"
      active={tab}
      items={[
        { key: "accounts", label: "Users", icon: <Users />, href: "/admin/people?tab=accounts", count: pending },
        { key: "knowledge", label: "Knowledge", icon: <GraduationCap />, href: "/admin/people?tab=knowledge" },
      ]}
    >
      {tab === "accounts" ? <AccountsTab /> : <KnowledgeTab />}
    </SideTabs>
  );
}
