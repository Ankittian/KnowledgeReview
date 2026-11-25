import { redirect } from "next/navigation";

/** Feedback is now Admin > Review cards > Suggestions. Old links and bookmarks land there. */
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ status?: string; card?: string }> }) {
  const { status, card } = await searchParams;
  const p = new URLSearchParams({ tab: "fix" });
  if (status) p.set("status", status);
  if (card) p.set("card", card);
  redirect(`/admin/review?${p}`);
}
