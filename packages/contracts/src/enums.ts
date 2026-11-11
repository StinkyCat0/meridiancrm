export type TopLevelEntity =
  | "contact"
  | "company"
  | "deal"
  | "location"
  | "job"
  | "estimate"
  | "invoice"
  | "communication";

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
  "NO_SHOW",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Allowed job transitions. A status always maps to itself (no-op). Completed,
 * canceled and no-show jobs are terminal except that a no-show can be
 * rebooked, which is the one recovery path dispatch actually needs.
 */
export const JOB_STATUS_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  UNSCHEDULED: ["UNSCHEDULED", "SCHEDULED", "DISPATCHED", "CANCELED", "NO_SHOW"],
  SCHEDULED: ["SCHEDULED", "DISPATCHED", "IN_PROGRESS", "COMPLETED", "CANCELED", "NO_SHOW"],
  DISPATCHED: ["DISPATCHED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELED", "NO_SHOW"],
  IN_PROGRESS: ["IN_PROGRESS", "COMPLETED", "CANCELED"],
  COMPLETED: ["COMPLETED"],
  CANCELED: ["CANCELED"],
  NO_SHOW: ["NO_SHOW", "SCHEDULED", "CANCELED"],
};

export const BUSINESS_TYPES = [
  "GENERAL",
  "SALON",
  "NAIL_SALON",
  "BARBERSHOP",
  "HVAC",
  "WINDOW_CLEANING",
  "RESIDENTIAL_CLEANING",
  "PLUMBING",
  "LANDSCAPING",
  "PEST_CONTROL",
  "OTHER",
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const COMMUNICATION_CHANNELS = ["CALL", "SMS", "EMAIL"] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const COMMUNICATION_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;
export type CommunicationDirection = (typeof COMMUNICATION_DIRECTIONS)[number];

export const COMMUNICATION_STATUSES = [
  "LOGGED",
  "QUEUED",
  "SENT",
  "DELIVERED",
  "FAILED",
  "MISSED",
  "RECEIVED",
] as const;
export type CommunicationStatus = (typeof COMMUNICATION_STATUSES)[number];

export const COMMUNICATION_INTENTS = [
  "GENERAL",
  "REMINDER",
  "FOLLOW_UP",
  "QUOTE",
  "PAYMENT",
  "REVIEW",
  "WINBACK",
  "RESCHEDULE",
] as const;
export type CommunicationIntent = (typeof COMMUNICATION_INTENTS)[number];

export const COMMUNICATION_SENTIMENTS = ["POSITIVE", "NEUTRAL", "NEGATIVE"] as const;
export type CommunicationSentiment = (typeof COMMUNICATION_SENTIMENTS)[number];

export const AUTOMATION_TRIGGERS = [
  "JOB_CREATED",
  "JOB_COMPLETED",
  "JOB_CANCELED",
  "JOB_NO_SHOW",
  "INVOICE_OVERDUE",
  "QUOTE_SENT",
  "QUOTE_APPROVED",
  "CUSTOMER_CREATED",
  "APPOINTMENT_UPCOMING",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_ACTION_TYPES = [
  "CREATE_TASK",
  "SEND_MESSAGE",
  "ADD_TAG",
  "REQUEST_REVIEW",
] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export const AUTOMATION_RUN_STATUSES = ["SUCCESS", "SKIPPED", "FAILED"] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export const EXPENSE_CATEGORIES = [
  "SUPPLIES",
  "FUEL",
  "PAYROLL",
  "MARKETING",
  "SOFTWARE",
  "RENT",
  "INSURANCE",
  "EQUIPMENT",
  "OTHER",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const PAYMENT_METHODS = [
  "CARD",
  "CASH",
  "CHECK",
  "ACH",
  "TRANSFER",
  "ADJUSTMENT",
  "OTHER",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const RECOMMENDATION_KINDS = [
  "CHURN_RISK",
  "NO_SHOW_RISK",
  "UPSELL",
  "COLLECTIONS",
  "REVIEW_REQUEST",
  "STAFFING",
  "REVENUE_FORECAST",
  "QUOTE_FOLLOW_UP",
  "ROUTE",
] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

export const RECOMMENDATION_SEVERITIES = ["INFO", "MEDIUM", "HIGH"] as const;
export type RecommendationSeverity = (typeof RECOMMENDATION_SEVERITIES)[number];

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
  NO_SHOW: { label: "No-show", tone: "danger" },
};

export const BUSINESS_TYPE_META: Record<BusinessType, { label: string; short: string }> = {
  GENERAL: { label: "Home services", short: "Services" },
  SALON: { label: "Hair salon", short: "Salon" },
  NAIL_SALON: { label: "Nail salon", short: "Nails" },
  BARBERSHOP: { label: "Barbershop", short: "Barber" },
  HVAC: { label: "HVAC", short: "HVAC" },
  WINDOW_CLEANING: { label: "Window cleaning", short: "Windows" },
  RESIDENTIAL_CLEANING: { label: "Residential cleaning", short: "Cleaning" },
  PLUMBING: { label: "Plumbing", short: "Plumbing" },
  LANDSCAPING: { label: "Landscaping", short: "Landscape" },
  PEST_CONTROL: { label: "Pest control", short: "Pest" },
  OTHER: { label: "Other", short: "Other" },
};

export const COMMUNICATION_CHANNEL_META: Record<
  CommunicationChannel,
  { label: string; short: string }
> = {
  CALL: { label: "Call", short: "Call" },
  SMS: { label: "Text", short: "Text" },
  EMAIL: { label: "Email", short: "Email" },
};

export const COMMUNICATION_INTENT_META: Record<CommunicationIntent, string> = {
  GENERAL: "General",
  REMINDER: "Appointment reminder",
  FOLLOW_UP: "Follow-up",
  QUOTE: "Quote",
  PAYMENT: "Payment",
  REVIEW: "Review request",
  WINBACK: "Win-back",
  RESCHEDULE: "Reschedule",
};

export const AUTOMATION_TRIGGER_META: Record<AutomationTrigger, { label: string; entity: string }> = {
  JOB_CREATED: { label: "Job created", entity: "job" },
  JOB_COMPLETED: { label: "Job completed", entity: "job" },
  JOB_CANCELED: { label: "Job canceled", entity: "job" },
  JOB_NO_SHOW: { label: "Customer no-show", entity: "job" },
  INVOICE_OVERDUE: { label: "Invoice overdue", entity: "invoice" },
  QUOTE_SENT: { label: "Quote sent", entity: "estimate" },
  QUOTE_APPROVED: { label: "Quote approved", entity: "estimate" },
  CUSTOMER_CREATED: { label: "Customer created", entity: "company" },
  APPOINTMENT_UPCOMING: { label: "Appointment tomorrow", entity: "job" },
};

export const EXPENSE_CATEGORY_META: Record<ExpenseCategory, string> = {
  SUPPLIES: "Supplies",
  FUEL: "Fuel",
  PAYROLL: "Payroll",
  MARKETING: "Marketing",
  SOFTWARE: "Software",
  RENT: "Rent",
  INSURANCE: "Insurance",
  EQUIPMENT: "Equipment",
  OTHER: "Other",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CARD: "Card",
  CASH: "Cash",
  CHECK: "Check",
  ACH: "ACH",
  TRANSFER: "Transfer",
  ADJUSTMENT: "Adjustment",
  OTHER: "Other",
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
