import {
  Building2,
  CalendarClock,
  CircleDollarSign,
  LayoutDashboard,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Match only the exact route (used for the app index). */
  end?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Overview", to: "/app", icon: LayoutDashboard, end: true },
  { label: "Contacts", to: "/app/contacts", icon: Users },
  { label: "Companies", to: "/app/companies", icon: Building2 },
  { label: "Deals", to: "/app/deals", icon: CircleDollarSign },
  { label: "Activities", to: "/app/activities", icon: CalendarClock },
];

export function sectionLabel(pathname: string): string {
  const match = [...NAV_ITEMS]
    .filter((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (match) return match.label;
  if (pathname.startsWith("/app/settings")) return "Settings";
  return "Workspace";
}
