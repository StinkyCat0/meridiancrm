import {
  Building2,
  CalendarClock,
  CircleDollarSign,
  FileText,
  LayoutDashboard,
  Receipt,
  Tags,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Match only the exact route (used for the app index). */
  end?: boolean;
}

/** Full desktop navigation. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Overview", to: "/app", icon: LayoutDashboard, end: true },
  { label: "Schedule", to: "/app/schedule", icon: Wrench },
  { label: "Customers", to: "/app/companies", icon: Building2 },
  { label: "Estimates", to: "/app/estimates", icon: FileText },
  { label: "Invoices", to: "/app/invoices", icon: Receipt },
  { label: "Services", to: "/app/services", icon: Tags },
  { label: "Contacts", to: "/app/contacts", icon: Users },
  { label: "Deals", to: "/app/deals", icon: CircleDollarSign },
  { label: "Activities", to: "/app/activities", icon: CalendarClock },
];

/**
 * The mobile tab bar must stay at five items. The rest remain reachable from
 * the command palette and the desktop sidebar.
 */
export const MOBILE_NAV_ITEMS: readonly NavItem[] = [
  { label: "Overview", to: "/app", icon: LayoutDashboard, end: true },
  { label: "Schedule", to: "/app/schedule", icon: Wrench },
  { label: "Customers", to: "/app/companies", icon: Building2 },
  { label: "Estimates", to: "/app/estimates", icon: FileText },
  { label: "Invoices", to: "/app/invoices", icon: Receipt },
];

export function sectionLabel(pathname: string): string {
  const match = [...NAV_ITEMS]
    .filter((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (match) return match.label;
  if (pathname.startsWith("/app/settings")) return "Settings";
  return "Workspace";
}
