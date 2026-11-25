import { redirect } from "next/navigation";

/** Users and Team knowledge became People. Old links and bookmarks land there. */
export default function TeamPage() {
  redirect("/admin/people?tab=knowledge");
}
