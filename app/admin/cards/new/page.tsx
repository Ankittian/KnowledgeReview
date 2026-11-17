import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { CardsTabs } from "@/components/admin/cards/bits";
import { NewGenerationForm } from "@/components/admin/cards/NewGenerationForm";
import { requireRole } from "@/lib/auth/session";
import { serverLimits } from "@/lib/cards/generate/jobs";
import { loadGenerationOptions } from "@/lib/cards/generate/options";

export const metadata: Metadata = { title: "New card generation" };

export default async function NewGenerationPage() {
  await requireRole(["admin"]);
  const options = await loadGenerationOptions(await getDb());
  return (
    <div className="space-y-5">
      <CardsTabs active="new" />
      <NewGenerationForm options={options} maxCards={serverLimits().maxCardsPerJob} />
    </div>
  );
}
