import {
  BarChart3,
  Database,
  Layers,
  MessageSquare,
  MessagesSquare,
  MessageSquareWarning,
  Search,
  Settings2,
  ShieldCheck,
  Stethoscope,
  Trophy,
  Users,
  UsersRound,
  type LucideIcon,
  Network,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description?: string;
}

export const MAIN_NAV: NavItem[] = [
  { href: "/chat", label: "Chat", icon: MessageSquare, description: "Ask questions about SpectrumERP" },
  { href: "/today", label: "Today", icon: Layers, description: "Review today’s flashcards" },
  { href: "/progress", label: "Progress", icon: BarChart3, description: "Your streak and knowledge by area" },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy, description: "Points from correct answers" },
  { href: "/browse", label: "Browse", icon: Search, description: "Search and study every card" },
];

/** Admin + reviewer sections. `adminOnly` items are hidden from reviewers. */
export const ADMIN_NAV: (NavItem & { adminOnly?: boolean })[] = [
  { href: "/admin/health", label: "What needs change", icon: Stethoscope, description: "Flagged knowledge, worst first" },
  { href: "/admin/feedback", label: "Feedback", icon: MessageSquareWarning, description: "Triage suggested corrections" },
  { href: "/admin/team", label: "Team knowledge", icon: UsersRound, description: "Knowledge and coverage per employee" },
  { href: "/admin/graph", label: "Knowledge graph", icon: Network, adminOnly: true, description: "Explore the Neo4j knowledge graph" },
  { href: "/admin/users", label: "Users", icon: Users, adminOnly: true, description: "Approve sign-ups, roles and access" },
  { href: "/admin/chats", label: "All chats", icon: MessagesSquare, adminOnly: true, description: "Every assistant conversation" },
  { href: "/admin/settings", label: "Settings", icon: Settings2, adminOnly: true, description: "Daily limit, banner, email and exports" },
];

export const ADMIN_ROOT: NavItem = { href: "/admin", label: "Admin", icon: ShieldCheck };
export const KB_ICON = Database;

export const isActive = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

export function adminItems(isAdmin: boolean) {
  return ADMIN_NAV.filter((i) => isAdmin || !i.adminOnly);
}

/** Title for the current path, used by the top-bar breadcrumb. */
export function sectionFor(path: string): { group: string | null; label: string } {
  if (isActive(path, "/profile") || isActive(path, "/account")) return { group: null, label: "Profile" };
  const a = ADMIN_NAV.find((i) => isActive(path, i.href));
  if (a) return { group: "Admin", label: a.label };
  const m = MAIN_NAV.find((i) => isActive(path, i.href));
  return { group: null, label: m?.label ?? "Knowledge Review" };
}
