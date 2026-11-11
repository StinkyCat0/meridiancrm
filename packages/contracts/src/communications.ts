import { z } from "zod";
import { idSchema, optionalDate, optionalText, paginationSchema } from "./common.js";
import {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_DIRECTIONS,
  COMMUNICATION_INTENTS,
  COMMUNICATION_SENTIMENTS,
  COMMUNICATION_STATUSES,
  type CommunicationChannel,
  type CommunicationDirection,
  type CommunicationIntent,
  type CommunicationSentiment,
  type CommunicationStatus,
} from "./enums.js";
import type { PublicUser } from "./entities.js";
import type { CustomerSummary } from "./service.js";

export interface CommunicationContact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
}

export interface Communication {
  id: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  status: CommunicationStatus;
  intent: CommunicationIntent;
  sentiment: CommunicationSentiment;
  subject: string | null;
  body: string | null;
  customer: CustomerSummary | null;
  contact: CommunicationContact | null;
  jobId: string | null;
  jobNumber: string | null;
  user: PublicUser | null;
  provider: string;
  externalId: string | null;
  aiGenerated: boolean;
  aiRationale: string | null;
  readAt: string | null;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunicationThread {
  customer: CustomerSummary;
  lastMessage: Communication;
  messageCount: number;
  unreadCount: number;
  channels: CommunicationChannel[];
}

export interface CommunicationStats {
  total: number;
  calls: number;
  texts: number;
  emails: number;
  inbound: number;
  outbound: number;
  unread: number;
  callsToday: number;
  textsToday: number;
  followUpsOpen: number;
}

export type DraftTone = "WARM" | "PROFESSIONAL" | "BRIEF";

export interface CommunicationDraft {
  channel: CommunicationChannel;
  intent: CommunicationIntent;
  subject: string | null;
  body: string;
  rationale: string;
  tone: DraftTone;
}

export const communicationInputSchema = z
  .object({
    channel: z.enum(COMMUNICATION_CHANNELS),
    direction: z.enum(COMMUNICATION_DIRECTIONS).default("OUTBOUND"),
    status: z.enum(COMMUNICATION_STATUSES).optional(),
    intent: z.enum(COMMUNICATION_INTENTS).default("GENERAL"),
    sentiment: z.enum(COMMUNICATION_SENTIMENTS).default("NEUTRAL"),
    subject: optionalText(200),
    body: optionalText(5000),
    customerId: z.preprocess(
      (value) => (value === "" ? null : value),
      idSchema.nullable().optional(),
    ),
    contactId: z.preprocess(
      (value) => (value === "" ? null : value),
      idSchema.nullable().optional(),
    ),
    jobId: z.preprocess(
      (value) => (value === "" ? null : value),
      idSchema.nullable().optional(),
    ),
    occurredAt: optionalDate,
  })
  .refine((value) => Boolean(value.customerId ?? value.contactId ?? value.jobId), {
    message: "A communication needs a customer, contact, or job",
    path: ["customerId"],
  });

export const communicationPatchSchema = z.object({
  readAt: optionalDate,
  sentiment: z.enum(COMMUNICATION_SENTIMENTS).optional(),
});

export const communicationListQuerySchema = paginationSchema.extend({
  channel: z.enum(COMMUNICATION_CHANNELS).optional(),
  direction: z.enum(COMMUNICATION_DIRECTIONS).optional(),
  customerId: z.string().trim().max(64).optional(),
  contactId: z.string().trim().max(64).optional(),
  jobId: z.string().trim().max(64).optional(),
  unread: z.enum(["true", "false"]).optional(),
});

export const communicationThreadQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const communicationDraftInputSchema = z.object({
  customerId: idSchema,
  channel: z.enum(COMMUNICATION_CHANNELS).default("SMS"),
  intent: z.enum(COMMUNICATION_INTENTS).default("FOLLOW_UP"),
  jobId: z.preprocess(
    (value) => (value === "" ? null : value),
    idSchema.nullable().optional(),
  ),
  tone: z.enum(["WARM", "PROFESSIONAL", "BRIEF"]).default("WARM"),
});

export const communicationSendDraftSchema = communicationInputSchema.extend({
  aiGenerated: z.boolean().default(false),
  aiRationale: optionalText(500),
});

export type CommunicationInput = z.infer<typeof communicationInputSchema>;
export type CommunicationPatchInput = z.infer<typeof communicationPatchSchema>;
export type CommunicationListQuery = z.infer<typeof communicationListQuerySchema>;
export type CommunicationDraftInput = z.infer<typeof communicationDraftInputSchema>;
