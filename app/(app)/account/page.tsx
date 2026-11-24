import { redirect } from "next/navigation";

/** The account page became the profile page (email + password). Old links and bookmarks land there. */
export default function AccountPage() {
  redirect("/profile");
}
