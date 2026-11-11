import { z } from "zod";
import {
  ACTIVITY_TYPES,
  CURRENCIES,
  CUSTOMER_TYPES,
  INDUSTRIES,
  ROLES,
  STAGE_KINDS,
  type CustomerType,
} from "./enums.js";
import { emailSchema, idSchema, optionalDate, optionalText, optionalUrl } from "./common.js";

const tagsSchema = z.array(z.string().trim().min(1).max(30)).max(12).default([]);

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  currency: string;
  createdAt: string;
}

export interface CompanySummary {
  id: string;
  name: string;
  domain: string | null;
}

export interface ContactSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

export interface Company {
  id: string;
  name: string;
  customerType: CustomerType;
  domain: string | null;
  industry: string | null;
  size: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  notes: string | null;
  tags: string[];
  archived: boolean;
  owner: PublicUser | null;
  contactCount: number;
  locationCount: number;
  openJobCount: number;
  dealCount: number;
  openPipelineValue: number;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  company: CompanySummary | null;
  owner: PublicUser | null;
  tags: string[];
  archived: boolean;
  lastActivityAt: string | null;
  openDealCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Stage {
  id: string;
  pipelineId: string;
  name: string;
  order: number;
  probability: number;
  kind: (typeof STAGE_KINDS)[number];
  targetDays: number;
}

export interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  stages: Stage[];
}

export interface MomentumBreakdown {
  key: "recency" | "engagement" | "stage" | "closeDate";
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface Momentum {
  score: number;
  band: "hot" | "warm" | "cold";
  breakdown: MomentumBreakdown[];
}

export interface Deal {
  id: string;
  title: string;
  value: number;
  currency: string;
  probability: number;
  stageId: string;
  stage: Stage;
  pipelineId: string;
  contact: ContactSummary | null;
  company: CompanySummary | null;
  owner: PublicUser | null;
  expectedCloseDate: string | null;
  closedAt: string | null;
  stageChangedAt: string;
  description: string | null;
  tags: string[];
  momentum: Momentum;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  type: (typeof ACTIVITY_TYPES)[number];
  title: string;
  body: string | null;
  dueAt: string | null;
  completedAt: string | null;
  contact: ContactSummary | null;
  company: CompanySummary | null;
  dealId: string | null;
  dealTitle: string | null;
  owner: PublicUser | null;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  id: string;
  user: PublicUser;
  role: (typeof ROLES)[number];
  joinedAt: string;
}

export interface Invite {
  id: string;
  email: string;
  role: (typeof ROLES)[number];
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  invitedBy: PublicUser | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  actor: PublicUser | null;
  createdAt: string;
}

export interface StageHistoryEntry {
  id: string;
  stageId: string;
  stageName: string;
  fromStageId: string | null;
  changedAt: string;
  changedBy: PublicUser | null;
}

// ---------- Input schemas ----------

const baseFields = {
  tags: tagsSchema.optional(),
};

export const companyInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  customerType: z.enum(CUSTOMER_TYPES).default("COMMERCIAL"),
  email: z.preprocess((v) => (v === "" ? null : v), emailSchema.nullable().optional()),
  domain: optionalText(200),
  industry: z.preprocess(
    (v) => (v === "" ? null : v),
    z.enum(INDUSTRIES).nullable().optional(),
  ),
  size: optionalText(40),
  phone: optionalText(40),
  website: optionalUrl,
  address: optionalText(300),
  notes: optionalText(5000),
  ...baseFields,
  archived: z.boolean().optional(),
  ownerId: z.preprocess((v) => (v === "" ? null : v), idSchema.nullable().optional()),
});

export const contactInputSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.preprocess((v) => (v === "" ? null : v), emailSchema.nullable().optional()),
  phone: optionalText(40),
  title: optionalText(120),
  companyId: z.preprocess((v) => (v === "" ? null : v), idSchema.nullable().optional()),
  ...baseFields,
  archived: z.boolean().optional(),
  ownerId: z.preprocess((v) => (v === "" ? null : v), idSchema.nullable().optional()),
});

export const dealInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  value: z.coerce.number().int().min(0).max(1_000_000_000),
  currency: z.enum(CURRENCIES).default("USD"),
  stageId: idSchema,
  contactId: z.preprocess((v) => (v === "" ? null : v), idSchema.nullable().optional()),
  companyId: z.preprocess((v) => (v === "" ? null : v), idSchema.nullable().optional()),
  expectedCloseDate: optionalDate,
  description: optionalText(5000),
  ...baseFields,
  ownerId: z.preprocess((v) => (v === "" ? null : v), idSchema.nullable().optional()),
});

export const dealPatchSchema = dealInputSchema.partial();

export const stageMoveSchema = z.object({
  stageId: idSchema,
});

export const activityInputSchema = z.object({
  type: z.enum(ACTIVITY_TYPES).default("NOTE"),
  title: z.string().trim().min(1).max(160),
  body: optionalText(5000),
  dueAt: optionalDate,
  completedAt: optionalDate,
  contactId: z.preprocess((v) => (v === "" ? null : v), idSchema.nullable().optional()),
  companyId: z.preprocess((v) => (v === "" ? null : v), idSchema.nullable().optional()),
  dealId: z.preprocess((v) => (v === "" ? null : v), idSchema.nullable().optional()),
});

export const activityPatchSchema = activityInputSchema.partial();

export const stageInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  probability: z.coerce.number().int().min(0).max(100),
  kind: z.enum(STAGE_KINDS).default("OPEN"),
  targetDays: z.coerce.number().int().min(1).max(365).default(30),
});

export const stagePatchSchema = stageInputSchema.partial().omit({});

export const inviteInputSchema = z.object({
  email: emailSchema,
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

export const memberPatchSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER"]),
});
