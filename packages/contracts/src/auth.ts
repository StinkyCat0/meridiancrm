import { z } from "zod";
import { BUSINESS_TYPES, ROLES } from "./enums.js";
import { emailSchema, optionalText, optionalUrl } from "./common.js";
import type { PublicUser, WorkspaceSummary } from "./entities.js";

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: emailSchema,
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(200)
    .regex(/[a-zA-Z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a number"),
  workspaceName: z.string().trim().min(2).max(80),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const websiteExchangeSchema = z.object({
  token: z.string().min(20).max(4000),
});
export type WebsiteExchange = z.infer<typeof websiteExchangeSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(500),
  name: z.string().trim().min(2).max(80).optional(),
  password: z.string().min(10).max(200).optional(),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  avatarUrl: optionalUrl,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
});

export const workspaceUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  currency: z.enum(["USD", "EUR", "GBP", "CAD", "AUD", "JPY"]).optional(),
  businessType: z.enum(BUSINESS_TYPES).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  serviceArea: optionalText(160),
  depotLatitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  depotLongitude: z.coerce.number().min(-180).max(180).nullable().optional(),
});

export interface AuthSession {
  accessToken: string;
  expiresIn: number;
  user: PublicUser;
  workspace: WorkspaceSummary;
  role: (typeof ROLES)[number];
}

export interface MeResponse {
  user: PublicUser;
  workspace: WorkspaceSummary;
  role: (typeof ROLES)[number];
  members: number;
}
