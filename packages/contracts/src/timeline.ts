import type { CustomerSummary } from "./service.js";

export type TimelineEntryKind =
  | "activity"
  | "communication"
  | "job"
  | "estimate"
  | "invoice"
  | "payment";

export interface TimelineEntry {
  id: string;
  kind: TimelineEntryKind;
  at: string;
  title: string;
  detail: string | null;
  status: string | null;
  amount: number | null;
  entityId: string | null;
  href: string | null;
  channel: string | null;
}

export interface CustomerTimeline {
  customer: CustomerSummary;
  items: TimelineEntry[];
  counts: Record<TimelineEntryKind, number>;
}
