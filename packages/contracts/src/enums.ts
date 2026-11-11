export type TopLevelEntity =
  | "contact"
  | "company"
  | "deal"
  | "location"
  | "job"
  | "estimate"
  | "invoice";

export const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export const ACTIVITY_TYPES = ["NOTE", "CALL", "EMAIL", "MEETING", "TASK"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const STAGE_KINDS = ["OPEN", "WON", "LOST"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const INDUSTRIES = [
  "Cleaning",
  "HVAC",
  "Plumbing",
  "Electrical",
  "Utilities",
  "Landscaping",
  "Pest Control",
  "Salon & Spa",
  "Home Services",
  "Property Management",
  "Healthcare",
  "Hospitality",
  "Real Estate",
  "Agency",
  "E-commerce",
  "Financial Services",
  "Media",
  "SaaS",
  "Other",
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"] as const;
export type Currency = (typeof CURRENCIES)[number];

/* -------------------------------------------------------------------------- */
/* Service operations                                                          */
/* -------------------------------------------------------------------------- */

export const CUSTOMER_TYPES = ["RESIDENTIAL", "COMMERCIAL", "PROPERTY_MANAGER"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const SERVICE_UNITS = ["VISIT", "HOUR", "SQFT", "ROOM", "UNIT", "ITEM"] as const;
export type ServiceUnit = (typeof SERVICE_UNITS)[number];

export const JOB_STATUSES = [
  "UNSCHEDULED",
  "SCHEDULED",
  "DISPATCHED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const ESTIMATE_STATUSES = ["DRAFT", "SENT", "APPROVED", "DECLINED", "EXPIRED"] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const INVOICE_STATUSES = ["DRAFT", "SENT", "PARTIAL", "PAID", "VOID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const RECURRENCE_FREQUENCIES = [
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "ANNUAL",
] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** Statuses that still count as work on the board. */
export const OPEN_JOB_STATUSES: readonly JobStatus[] = [
  "UNSCHEDULED",
  "SCHEDULED",
  "DISPATCHED",
  "IN_PROGRESS",
];

export const CUSTOMER_TYPE_META: Record<CustomerType, { label: string; short: string }> = {
  RESIDENTIAL: { label: "Residential", short: "Home" },
  COMMERCIAL: { label: "Commercial", short: "Business" },
  PROPERTY_MANAGER: { label: "Property manager", short: "Portfolio" },
};

export const SERVICE_UNIT_META: Record<ServiceUnit, { label: string; short: string }> = {
  VISIT: { label: "Per visit", short: "visit" },
  HOUR: { label: "Per hour", short: "hr" },
  SQFT: { label: "Per sq ft", short: "sq ft" },
  ROOM: { label: "Per room", short: "room" },
  UNIT: { label: "Per unit", short: "unit" },
  ITEM: { label: "Per item", short: "item" },
};

export const JOB_PRIORITY_META: Record<
  JobPriority,
  { label: string; tone: "accent" | "success" | "warning" | "danger" | "neutral" }
> = {
  LOW: { label: "Low", tone: "neutral" },
  NORMAL: { label: "Normal", tone: "accent" },
  HIGH: { label: "High", tone: "warning" },
  URGENT: { label: "Urgent", tone: "danger" },
};

export const JOB_STATUS_META: Record<
  JobStatus,
  { label: string; tone: "accent" | "success" | "warning" | "danger" | "neutral" }
> = {
  UNSCHEDULED: { label: "Unscheduled", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "accent" },
  DISPATCHED: { label: "Dispatched", tone: "warning" },
  IN_PROGRESS: { label: "In progress", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELED: { label: "Canceled", tone: "danger" },
};

export const ESTIMATE_STATUS_META: Record<
  EstimateStatus,
  { label: string; tone: "accent" | "success" | "warning" | "danger" | "neutral" }
> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SENT: { label: "Sent", tone: "accent" },
  APPROVED: { label: "Approved", tone: "success" },
  DECLINED: { label: "Declined", tone: "danger" },
  EXPIRED: { label: "Expired", tone: "warning" },
};

export const INVOICE_STATUS_META: Record<
  InvoiceStatus,
  { label: string; tone: "accent" | "success" | "warning" | "danger" | "neutral" }
> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SENT: { label: "Sent", tone: "accent" },
  PARTIAL: { label: "Partial", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  VOID: { label: "Void", tone: "danger" },
};

export const RECURRENCE_LABEL: Record<RecurrenceFrequency, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  SEMIANNUAL: "Every 6 months",
  ANNUAL: "Annually",
};

export const ACTIVITY_TYPE_META: Record<
  ActivityType,
  { label: string; preposition: string }
> = {
  NOTE: { label: "Note", preposition: "on" },
  CALL: { label: "Call", preposition: "with" },
  EMAIL: { label: "Email", preposition: "to" },
  MEETING: { label: "Meeting", preposition: "with" },
  TASK: { label: "Task", preposition: "for" },
};

export const ROLE_RANK: Record<Role, number> = { MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function atLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
