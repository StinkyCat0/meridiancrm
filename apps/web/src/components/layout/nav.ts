import {
  BarChart3,
  Building2,
  CalendarDays,
  Contact,
  FileText,
  LayoutDashboard,
  MapPinned,
  MessageSquare,
  Receipt,
  Sparkles,
  Tags,
  Target,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Match only the exact route (used for the app index). */
  end?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Grouped desktop navigation: operate the day, grow revenue, run the business. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Operate",
    items: [
      { label: "Overview", to: "/app", icon: LayoutDashboard, end: true },
      { label: "Dispatch", to: "/app/dispatch", icon: MapPinned },
      { label: "Calendar", to: "/app/calendar", icon: CalendarDays },
      { label: "Jobs", to: "/app/schedule", icon: Wrench },
    ],
  },
  {
    label: "Grow",
    items: [
      { label: "Customers", to: "/app/companies", icon: Building2 },
      { label: "Contacts", to: "/app/contacts", icon: Contact },
      { label: "Inbox", to: "/app/inbox", icon: MessageSquare },
      { label: "Quotes", to: "/app/estimates", icon: FileText },
      { label: "Invoices", to: "/app/invoices", icon: Receipt },
      { label: "Revenue", to: "/app/revenue", icon: BarChart3 },
      { label: "Leads", to: "/app/deals", icon: Target },
    ],
  },
  {
    label: "Run",
    items: [
      { label: "Automations", to: "/app/automations", icon: Zap },
      { label: "Intelligence", to: "/app/intelligence", icon: Sparkles },
      { label: "Team", to: "/app/team", icon: Users },
      { label: "Price book", to: "/app/services", icon: Tags },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/**
 * The mobile tab bar must stay at five items. The rest remain reachable from
 * the command palette and the desktop sidebar.
 */
export const MOBILE_NAV_ITEMS: readonly NavItem[] = [
  { label: "Overview", to: "/app", icon: LayoutDashboard, end: true },
  { label: "Dispatch", to: "/app/dispatch", icon: MapPinned },
  { label: "Inbox", to: "/app/inbox", icon: MessageSquare },
  { label: "Calendar", to: "/app/calendar", icon: CalendarDays },
  { label: "Customers", to: "/app/companies", icon: Building2 },
];

export function sectionLabel(pathname: string): string {
  const match = [...NAV_ITEMS]
    .filter((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (match) return match.label;
  if (pathname.startsWith("/app/settings")) return "Settings";
  return "Workspace";
}
