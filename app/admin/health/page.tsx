import { redirect } from "next/navigation";

/** "What needs change" is now Admin > Review cards. Old links and bookmarks land there. */
export default async function HealthPage({ searchParams }: { searchParams: Promise<{ view?: string; module?: string }> }) {
  const { view, module } = await searchParams;
  const p = new URLSearchParams();
  if (view === "forms" || view === "processes" || view === "rules" || view === "concepts") {
    p.set("tab", "overview");
    p.set("type", view);
  } else p.set("tab", "fix");
  if (module) p.set("module", module);
  redirect(`/admin/review?${p}`);
}
