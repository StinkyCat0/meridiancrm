import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

export const STUDIO_ACCOUNT_ROLES = ["user", "admin"] as const;
export type StudioAccountRole = (typeof STUDIO_ACCOUNT_ROLES)[number];

export const STUDIO_PLANS = ["free", "basic", "pro", "enterprise"] as const;
export type StudioPlan = (typeof STUDIO_PLANS)[number];

export const STUDIO_SUBSCRIPTION_STATUSES = [
  "active",
  "canceled",
  "past_due",
  "trialing",
] as const;
export type StudioSubscriptionStatus =
  (typeof STUDIO_SUBSCRIPTION_STATUSES)[number];

export const STUDIO_INQUIRY_STATUSES = ["new", "read", "archived"] as const;
export type StudioInquiryStatus = (typeof STUDIO_INQUIRY_STATUSES)[number];

export const STUDIO_INQUIRY_FILTERS = [
  "all",
  ...STUDIO_INQUIRY_STATUSES,
] as const;
export type StudioInquiryFilter = (typeof STUDIO_INQUIRY_FILTERS)[number];

export const STUDIO_DEMO_KEYS = [
  "dental",
  "luxesm",
  "bakery",
  "corrowear",
] as const;
export type StudioDemoKey = (typeof STUDIO_DEMO_KEYS)[number];

export const STUDIO_INTEGRATION_STATUSES = [
  "up",
  "down",
  "enabled",
  "disabled",
  "configured",
  "missing",
] as const;
export type StudioIntegrationStatus =
  (typeof STUDIO_INTEGRATION_STATUSES)[number];

/* -------------------------------------------------------------------------- */
/* Accounts                                                                    */
/* -------------------------------------------------------------------------- */

export const studioAccountAccessSchema = z.object({
  canLogin: z.boolean(),
  canAccessChat: z.boolean(),
  canAccessPremiumFeatures: z.boolean(),
  canAccessCrm: z.boolean(),
});
export type StudioAccountAccess = z.infer<typeof studioAccountAccessSchema>;

export const studioSubscriptionSchema = z.object({
  plan: z.enum(STUDIO_PLANS),
  status: z.enum(STUDIO_SUBSCRIPTION_STATUSES),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
});
export type StudioSubscription = z.infer<typeof studioSubscriptionSchema>;

export const studioAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(STUDIO_ACCOUNT_ROLES),
  isVerified: z.boolean(),
  isActive: z.boolean(),
  access: studioAccountAccessSchema,
  subscription: studioSubscriptionSchema,
  avatar: z.string().nullable(),
  createdAt: z.string(),
  lastLogin: z.string().nullable(),
});
export type StudioAccount = z.infer<typeof studioAccountSchema>;

export const studioAccountListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type StudioAccountListQuery = z.infer<
  typeof studioAccountListQuerySchema
>;

export const studioAccountUpdateSchema = z
  .object({
    canAccessCrm: z.boolean().optional(),
    canAccessChat: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one account field is required",
  });
export type StudioAccountUpdateInput = z.infer<
  typeof studioAccountUpdateSchema
>;

export const studioAccountPageSchema = z.object({
  items: z.array(studioAccountSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type StudioAccountPage = z.infer<typeof studioAccountPageSchema>;

export const studioAccountUpdateResponseSchema = z.object({
  account: studioAccountSchema,
});

/* -------------------------------------------------------------------------- */
/* Inquiries                                                                   */
/* -------------------------------------------------------------------------- */

export const studioInquirySchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  subject: z.string(),
  message: z.string(),
  status: z.enum(STUDIO_INQUIRY_STATUSES),
  crmDealId: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
});
export type StudioInquiry = z.infer<typeof studioInquirySchema>;

export const studioInquiryListQuerySchema = z.object({
  status: z.enum(STUDIO_INQUIRY_FILTERS).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type StudioInquiryListQuery = z.infer<
  typeof studioInquiryListQuerySchema
>;

export const studioInquiryUpdateSchema = z.object({
  status: z.enum(STUDIO_INQUIRY_STATUSES),
});
export type StudioInquiryUpdateInput = z.infer<
  typeof studioInquiryUpdateSchema
>;

export const studioInquiryPageSchema = z.object({
  items: z.array(studioInquirySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type StudioInquiryPage = z.infer<typeof studioInquiryPageSchema>;

export const studioInquiryUpdateResponseSchema = z.object({
  inquiry: studioInquirySchema,
});

/* -------------------------------------------------------------------------- */
/* Chat                                                                        */
/* -------------------------------------------------------------------------- */

export const studioChatRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  isReadOnly: z.boolean(),
  archived: z.boolean(),
  createdAt: z.string(),
  messageCount: z.number().int().optional(),
  lastMessageAt: z.string().nullable().optional(),
});
export type StudioChatRoom = z.infer<typeof studioChatRoomSchema>;

export const studioChatRoomsQuerySchema = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});
export type StudioChatRoomsQuery = z.input<typeof studioChatRoomsQuerySchema>;

export const studioRoomCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  isReadOnly: z.boolean().optional(),
});
export type StudioRoomCreateInput = z.infer<typeof studioRoomCreateSchema>;

export const studioRoomUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    isReadOnly: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one room field is required",
  });
export type StudioRoomUpdateInput = z.infer<typeof studioRoomUpdateSchema>;

export const studioChatRoomListSchema = z.object({
  items: z.array(studioChatRoomSchema),
});
export type StudioChatRoomList = z.infer<typeof studioChatRoomListSchema>;

export const studioChatRoomResponseSchema = z.object({
  room: studioChatRoomSchema,
});

export interface StudioMessageAuthor {
  id: string;
  name: string;
  avatar: string | null;
  role: string;
}

export interface StudioMessageAttachment {
  url: string;
  filename: string;
  type: string;
  size: number;
}

export interface StudioMessageReaction {
  emoji: string;
  userIds: string[];
}

export interface StudioMessage {
  id: string;
  roomId: string;
  content: string;
  author: StudioMessageAuthor | null;
  parentId: string | null;
  attachments: StudioMessageAttachment[];
  reactions: StudioMessageReaction[];
  edited: boolean;
  createdAt: string;
  replies: StudioMessage[];
  replyCount: number;
}

export const studioMessageSchema: z.ZodType<StudioMessage> = z.lazy(() =>
  z.object({
    id: z.string(),
    roomId: z.string(),
    content: z.string(),
    author: z
      .object({
        id: z.string(),
        name: z.string(),
        avatar: z.string().nullable(),
        role: z.string(),
      })
      .nullable(),
    parentId: z.string().nullable(),
    attachments: z.array(
      z.object({
        url: z.string(),
        filename: z.string(),
        type: z.string(),
        size: z.number().int(),
      }),
    ),
    reactions: z.array(
      z.object({
        emoji: z.string(),
        userIds: z.array(z.string()),
      }),
    ),
    edited: z.boolean(),
    createdAt: z.string(),
    replies: z.array(studioMessageSchema),
    replyCount: z.number().int(),
  }),
);

export const studioMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().max(200).optional(),
});
export type StudioMessagesQuery = z.infer<typeof studioMessagesQuerySchema>;

export const studioMessageCreateSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  parentId: z.string().max(64).optional(),
});
export type StudioMessageCreateInput = z.infer<
  typeof studioMessageCreateSchema
>;

export const studioMessageListSchema = z.object({
  items: z.array(studioMessageSchema),
});
export type StudioMessageList = z.infer<typeof studioMessageListSchema>;

export const studioMessageResponseSchema = z.object({
  message: studioMessageSchema,
});

/* -------------------------------------------------------------------------- */
/* Billing                                                                     */
/* -------------------------------------------------------------------------- */

export const studioBillingSummarySchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  pastDue: z.number().int(),
  canceling: z.number().int(),
  plans: z.object({
    free: z.number().int(),
    basic: z.number().int(),
    pro: z.number().int(),
    enterprise: z.number().int(),
  }),
});
export type StudioBillingSummary = z.infer<typeof studioBillingSummarySchema>;

export const studioBillingItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  plan: z.enum(STUDIO_PLANS),
  status: z.enum(STUDIO_SUBSCRIPTION_STATUSES),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  createdAt: z.string(),
});
export type StudioBillingItem = z.infer<typeof studioBillingItemSchema>;

export const studioBillingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type StudioBillingQuery = z.infer<typeof studioBillingQuerySchema>;

export const studioBillingPageSchema = z.object({
  summary: studioBillingSummarySchema,
  items: z.array(studioBillingItemSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type StudioBillingPage = z.infer<typeof studioBillingPageSchema>;

/* -------------------------------------------------------------------------- */
/* Demos                                                                       */
/* -------------------------------------------------------------------------- */

export const studioDemoSchema = z.object({
  key: z.enum(STUDIO_DEMO_KEYS),
  name: z.string(),
  path: z.string(),
  description: z.string(),
  visits: z.number().int(),
  lastVisitedAt: z.string().nullable(),
});
export type StudioDemo = z.infer<typeof studioDemoSchema>;

export const studioDemoSummarySchema = z.object({
  key: z.enum(STUDIO_DEMO_KEYS),
  name: z.string(),
  path: z.string(),
  visits: z.number().int(),
});

export const studioDemoListSchema = z.object({
  items: z.array(studioDemoSchema),
});
export type StudioDemoList = z.infer<typeof studioDemoListSchema>;

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export const studioSettingsIntegrationSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(STUDIO_INTEGRATION_STATUSES),
  detail: z.string().nullable().optional(),
});
export type StudioSettingsIntegration = z.infer<
  typeof studioSettingsIntegrationSchema
>;

export const studioSettingsLinkSchema = z.object({
  label: z.string(),
  url: z.string(),
});
export type StudioSettingsLink = z.infer<typeof studioSettingsLinkSchema>;

export const studioSettingsSchema = z.object({
  integrations: z.array(studioSettingsIntegrationSchema),
  links: z.array(studioSettingsLinkSchema),
});
export type StudioSettings = z.infer<typeof studioSettingsSchema>;

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

export const studioOverviewSchema = z.object({
  generatedAt: z.string(),
  accounts: z.object({
    total: z.number().int(),
    verified: z.number().int(),
    crmAccess: z.number().int(),
    active: z.number().int(),
    admins: z.number().int(),
  }),
  subscriptions: z.object({
    free: z.number().int(),
    basic: z.number().int(),
    pro: z.number().int(),
    enterprise: z.number().int(),
    pastDue: z.number().int(),
  }),
  inquiries: z.object({
    total: z.number().int(),
    new: z.number().int(),
    read: z.number().int(),
    archived: z.number().int(),
    last7Days: z.number().int(),
  }),
  chat: z.object({
    rooms: z.number().int(),
    messages: z.number().int(),
    messages7Days: z.number().int(),
  }),
  demos: z.array(studioDemoSummarySchema),
  integrations: z.object({
    mongo: z.enum(["up", "down"]),
    email: z.enum(["enabled", "disabled"]),
    crmIntake: z.enum(["configured", "missing"]),
    crmHandoff: z.enum(["configured", "missing"]),
  }),
});
export type StudioOverview = z.infer<typeof studioOverviewSchema>;

/* -------------------------------------------------------------------------- */
/* Website login handoff                                                       */
/* -------------------------------------------------------------------------- */

export const websiteHandoffSchema = z.object({
  code: z.string().trim().min(20).max(500),
});
export type WebsiteHandoffInput = z.infer<typeof websiteHandoffSchema>;

export const websiteHandoffPreviewSchema = z.object({
  websiteUserId: z.string(),
  email: z.string(),
  name: z.string(),
  isVerified: z.boolean(),
  crmAccess: z.boolean(),
  expiresAt: z.string(),
});
export type WebsiteHandoffPreview = z.infer<typeof websiteHandoffPreviewSchema>;
