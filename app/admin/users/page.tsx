import { redirect } from "next/navigation";

/** Users and Team knowledge became People. Old links and bookmarks land there. */
export default function UsersPage() {
  redirect("/admin/people?tab=accounts");
}
