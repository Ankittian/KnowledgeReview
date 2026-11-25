import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { Filter, ShieldCheck, TriangleAlert } from "lucide-react";
import { getDb, query } from "@/db/client";
import { SideTabs } from "@/components/admin/SideTabs";
import { SectionTitle } from "@/components/common/PageHeader";
import { ITEM_TYPES, ItemsTab, type ItemType } from "@/components/admin/review/ItemsTab";
import { OverviewTab } from "@/components/admin/review/OverviewTab";
import { FIX_STATUSES, NeedsFixTab } from "@/components/admin/review/NeedsFixTab";
import { buttonVariants } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { getModuleNames } from "@/lib/deck";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Review cards" };

const TABS = ["overview", "fix"] as const;
type Tab = (typeof TABS)[number];

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ tab?: string; module?: string; type?: string; status?: string; card?: string }> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  // Older links: "flagged" and "suggestions" became "fix"; "items" (By item) became part of "overview".
  const tab: Tab = sp.tab === "flagged" || sp.tab === "suggestions" ? "fix" : (TABS.find((t) => t === sp.tab) ?? "overview");
  const module = sp.module?.slice(0, 10) || "";
  const type: ItemType = ITEM_TYPES.find((t) => t.key === sp.type)?.key ?? "forms";
  const status = (FIX_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "open";
  const card = sp.card?.slice(0, 200);

  const db = await getDb();
  const [[{ n: open }], moduleNames] = await Promise.all([query<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM card_feedback WHERE status = 'open'`), getModuleNames(db)]);

  return (
    <SideTabs
      title="Review cards"
      active={tab}
      items={[
        { key: "overview", label: "Overview", icon: <ShieldCheck />, href: "/admin/review?tab=overview" },
        { key: "fix", label: "Suggestions", icon: <TriangleAlert />, href: "/admin/review?tab=fix", count: open },
      ]}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="tab" value={tab} />
            {tab === "overview" && (
              <NativeSelect name="type" defaultValue={type} aria-label="Item type" className="w-36">
                {ITEM_TYPES.map((t) => (
                  <NativeSelectOption key={t.key} value={t.key}>
                    {t.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
            <NativeSelect name="module" defaultValue={module} aria-label="Area" className="w-44">
              <NativeSelectOption value="">All areas</NativeSelectOption>
              {[...moduleNames].map(([code, name]) => (
                <NativeSelectOption key={code} value={code}>
                  {name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <button className={buttonVariants({ variant: "outline" })}>
              <Filter /> Apply
            </button>
          </form>
        </div>

        {tab === "fix" && <NeedsFixTab status={status} card={card} module={module} />}
        {tab === "overview" && (
          <div className="space-y-8">
            <OverviewTab module={module} />
            <section>
              <SectionTitle title="By item" description="Forms, processes, rules and concepts with employee verdicts, worst first. Pick the type above." />
              <ItemsTab type={type} module={module} />
            </section>
          </div>
        )}
      </div>
    </SideTabs>
  );
}
