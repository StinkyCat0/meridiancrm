export type TopLevelEntity = "contact" | "company" | "deal";

export const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export const ACTIVITY_TYPES = ["NOTE", "CALL", "EMAIL", "MEETING", "TASK"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const STAGE_KINDS = ["OPEN", "WON", "LOST"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const INDUSTRIES = [
  "Agency",
  "E-commerce",
  "Financial Services",
  "Healthcare",
  "Hospitality",
  "Media",
  "Real Estate",
  "SaaS",
  "Other",
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"] as const;
export type Currency = (typeof CURRENCIES)[number];

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
