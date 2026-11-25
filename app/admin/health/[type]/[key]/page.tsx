import { redirect } from "next/navigation";

/** Item pages moved under the review queue. */
export default async function HealthItemPage({ params }: { params: Promise<{ type: string; key: string }> }) {
  const { type, key } = await params;
  redirect(`/admin/review/${type}/${key}`);
}
