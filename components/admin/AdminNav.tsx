"use client";

import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/common/PageHeader";
import { ADMIN_NAV, isActive } from "@/components/shell/nav";

/** Page title for the current admin section. (The section list lives only in the sidebar.) */
export function AdminHeader() {
  const path = usePathname();
  const item = ADMIN_NAV.find((i) => isActive(path, i.href));
  return <PageHeader eyebrow="Administration" title={item?.label ?? "Administration"} description={item?.description} />;
}
