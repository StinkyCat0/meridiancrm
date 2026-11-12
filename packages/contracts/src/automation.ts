import { z } from "zod";
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_RUN_STATUSES,
  AUTOMATION_TRIGGERS,
  COMMUNICATION_CHANNELS,
  COMMUNICATION_INTENTS,
  CUSTOMER_TYPES,
  JOB_PRIORITIES,
  type AutomationActionType,
  type AutomationRunStatus,
  type AutomationTrigger,
  type CommunicationChannel,
  type CommunicationIntent,
  type CustomerType,
  type JobPriority,
} from "./enums.js";
import { optionalText, paginationSchema } from "./common.js";

export interface AutomationConditions {
  minTotal?: number;
  customerTypes?: CustomerType[];
  priorities?: JobPriority[];
}

export type AutomationAction =
  | {
      type: "CREATE_TASK";
      title: string;
      body?: string | null;
      dueInHours?: number;
    }
  | {
      type: "SEND_MESSAGE";
      channel: CommunicationChannel;
      intent: CommunicationIntent;
      body?: string | null;
    }
  | {
      type: "ADD_TAG";
      tag: string;
    }
  | {
      type: "REQUEST_REVIEW";
      channel: CommunicationChannel;
    };

export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  trigger: AutomationTrigger;
  conditions: AutomationConditions;
  actions: AutomationAction[];
  enabled: boolean;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: AutomationTrigger;
  status: AutomationRunStatus;
  entityType: string;
  entityId: string | null;
  detail: string | null;
  createdAt: string;
}

export const automationConditionSchema = z.object({
  minTotal: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  customerTypes: z.array(z.enum(CUSTOMER_TYPES)).max(3).optional(),
  priorities: z.array(z.enum(JOB_PRIORITIES)).max(4).optional(),
});

const createTaskAction = z.object({
  type: z.literal("CREATE_TASK"),
  title: z.string().trim().min(1).max(160),
  body: optionalText(2000),
  dueInHours: z.coerce.number().int().min(1).max(720).default(24),
});

const sendMessageAction = z.object({
  type: z.literal("SEND_MESSAGE"),
  channel: z.enum(COMMUNICATION_CHANNELS).default("SMS"),
  intent: z.enum(COMMUNICATION_INTENTS).default("FOLLOW_UP"),
  body: optionalText(2000),
});

const addTagAction = z.object({
  type: z.literal("ADD_TAG"),
  tag: z.string().trim().min(1).max(30),
});

const requestReviewAction = z.object({
  type: z.literal("REQUEST_REVIEW"),
  channel: z.enum(COMMUNICATION_CHANNELS).default("SMS"),
});

export const automationActionSchema = z.discriminatedUnion("type", [
  createTaskAction,
  sendMessageAction,
  addTagAction,
  requestReviewAction,
]);

export const automationRuleInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalText(500),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  conditions: automationConditionSchema.default({}),
  actions: z.array(automationActionSchema).min(1).max(5),
  enabled: z.boolean().default(true),
});

export const automationRulePatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: optionalText(500),
  trigger: z.enum(AUTOMATION_TRIGGERS).optional(),
  conditions: automationConditionSchema.optional(),
  actions: z.array(automationActionSchema).min(1).max(5).optional(),
  enabled: z.boolean().optional(),
});

export const automationListQuerySchema = paginationSchema.extend({
  trigger: z.enum(AUTOMATION_TRIGGERS).optional(),
  enabled: z.enum(["true", "false"]).optional(),
});

export const automationRunListQuerySchema = paginationSchema.extend({
  trigger: z.enum(AUTOMATION_TRIGGERS).optional(),
  status: z.enum(AUTOMATION_RUN_STATUSES).optional(),
  ruleId: z.string().trim().max(64).optional(),
});

export type AutomationRuleInput = z.infer<typeof automationRuleInputSchema>;
export type AutomationRulePatchInput = z.infer<typeof automationRulePatchSchema>;
export type AutomationActionInput = z.infer<typeof automationActionSchema>;
