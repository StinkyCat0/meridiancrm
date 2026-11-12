import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BUSINESS_TYPE_META,
  COMMUNICATION_CHANNELS,
  buildMessageDraft,
  communicationDraftInputSchema,
  communicationListQuerySchema,
  communicationPatchSchema,
  communicationSendDraftSchema,
  communicationThreadQuerySchema,
  formatMoney,
  type BusinessType,
  type Communication,
  type CommunicationChannel,
  type CommunicationDirection,
  type CommunicationIntent,
  type CommunicationSentiment,
  type CommunicationStats,
  type CommunicationStatus,
  type CommunicationThread,
  type PublicUser,
} from "@meridian/contracts";
import type { Prisma } from "@prisma/client";
import { authenticate, getAuth, requireRole } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/db.js";
import {
  badRequest,
  iso,
  likeTerm,
  notFound,
  pageMeta,
  parseOrThrow,
} from "../lib/http.js";
import {
  customerSelect,
  toCustomerSummary,
  userSelect,
} from "../lib/service-ops.js";

const idParamsSchema = z.object({ id: z.string().trim().min(1).max(64) });

export const communicationContactSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
} satisfies Prisma.ContactSelect;

export const communicationInclude = {
  customer: { select: customerSelect },
  contact: { select: communicationContactSelect },
  job: { select: { id: true, number: true } },
  user: { select: userSelect },
} satisfies Prisma.CommunicationInclude;

export type CommunicationRow = Prisma.CommunicationGetPayload<{
  include: typeof communicationInclude;
}>;

function toPublicUser(user: CommunicationRow["user"]): PublicUser | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

export function toCommunication(row: CommunicationRow): Communication {
  return {
    id: row.id,
    channel: row.channel as CommunicationChannel,
    direction: row.direction as CommunicationDirection,
    status: row.status as CommunicationStatus,
    intent: row.intent as CommunicationIntent,
    sentiment: row.sentiment as CommunicationSentiment,
    subject: row.subject,
    body: row.body,
    customer: row.customer ? toCustomerSummary(row.customer) : null,
    contact: row.contact
      ? {
          id: row.contact.id,
          firstName: row.contact.firstName,
          lastName: row.contact.lastName,
          phone: row.contact.phone,
          email: row.contact.email,
        }
      : null,
    jobId: row.job?.id ?? null,
    jobNumber: row.job?.number ?? null,
    user: toPublicUser(row.user),
    provider: row.provider,
    externalId: row.externalId,
    aiGenerated: row.aiGenerated,
    aiRationale: row.aiRationale,
    readAt: iso(row.readAt),
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadCommunication(
  workspaceId: string,
  id: string,
): Promise<CommunicationRow> {
  const row = await prisma.communication.findFirst({
    where: { id, workspaceId },
    include: communicationInclude,
  });
  if (!row) throw notFound("Communication");
  return row;
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/** Local midnight for the workspace's timezone, expressed as a UTC instant. */
function startOfDayInTimeZone(now: Date, timeZone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const utcMidnight = Date.UTC(get("year"), get("month") - 1, get("day"));
    const offset = timeZoneOffsetMs(new Date(utcMidnight), timeZone);
    const candidate = new Date(utcMidnight - offset);
    const candidateOffset = timeZoneOffsetMs(candidate, timeZone);
    return new Date(utcMidnight - candidateOffset);
  } catch {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }
}

function formatAppointment(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  }
}

async function matchingCustomerIds(
  workspaceId: string,
  query: string | undefined,
): Promise<string[] | null> {
  if (!query) return null;
  const term = likeTerm(query);
  const [customers, messages] = await Promise.all([
    prisma.company.findMany({
      where: { workspaceId, name: { contains: term } },
      select: { id: true },
      take: 500,
    }),
    prisma.communication.findMany({
      where: {
        workspaceId,
        customerId: { not: null },
        OR: [{ subject: { contains: term } }, { body: { contains: term } }],
      },
      select: { customerId: true },
      distinct: ["customerId"],
      take: 500,
    }),
  ]);
  const ids = new Set(customers.map((customer) => customer.id));
  for (const message of messages) {
    if (message.customerId) ids.add(message.customerId);
  }
  return [...ids];
}

export async function communicationsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/communications",
    {
      preHandler: authenticate,
      schema: {
        tags: ["communications"],
        summary:
          "List inbox communications with channel, direction and unread filters",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(communicationListQuerySchema, request.query);

      const where: Prisma.CommunicationWhereInput = {
        workspaceId: auth.workspaceId,
        ...(query.channel ? { channel: query.channel } : {}),
        ...(query.direction ? { direction: query.direction } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.contactId ? { contactId: query.contactId } : {}),
        ...(query.jobId ? { jobId: query.jobId } : {}),
        ...(query.q
          ? {
              OR: [
                { subject: { contains: likeTerm(query.q) } },
                { body: { contains: likeTerm(query.q) } },
                { customer: { name: { contains: likeTerm(query.q) } } },
                { contact: { firstName: { contains: likeTerm(query.q) } } },
                { contact: { lastName: { contains: likeTerm(query.q) } } },
              ],
            }
          : {}),
      };

      if (query.unread === "true") {
        where.direction = "INBOUND";
        where.readAt = null;
      } else if (query.unread === "false") {
        where.NOT = { direction: "INBOUND", readAt: null };
      }

      const [total, rows] = await Promise.all([
        prisma.communication.count({ where }),
        prisma.communication.findMany({
          where,
          include: communicationInclude,
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      return {
        data: rows.map(toCommunication),
        meta: pageMeta(total, query.page, query.pageSize),
      };
    },
  );

  app.get(
    "/communications/threads",
    {
      preHandler: authenticate,
      schema: {
        tags: ["communications"],
        summary: "Conversation threads grouped by customer",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<CommunicationThread[]> => {
      const auth = getAuth(request);
      const query = parseOrThrow(communicationThreadQuerySchema, request.query);
      const matchedIds = await matchingCustomerIds(auth.workspaceId, query.q);

      const where: Prisma.CommunicationWhereInput = {
        workspaceId: auth.workspaceId,
        customerId: matchedIds ? { in: matchedIds } : { not: null },
      };

      const groups = await prisma.communication.groupBy({
        by: ["customerId"],
        where,
        _count: { _all: true },
        _max: { occurredAt: true },
        orderBy: [{ _max: { occurredAt: "desc" } }],
        take: query.limit,
      });

      const customerIds = groups
        .map((group) => group.customerId)
        .filter((id): id is string => id !== null);
      if (customerIds.length === 0) return [];

      const pageWhere: Prisma.CommunicationWhereInput = {
        workspaceId: auth.workspaceId,
        customerId: { in: customerIds },
      };

      const [unreadGroups, channelGroups, customers, lastMessages] =
        await Promise.all([
          prisma.communication.groupBy({
            by: ["customerId"],
            where: { ...pageWhere, direction: "INBOUND", readAt: null },
            _count: { _all: true },
          }),
          prisma.communication.groupBy({
            by: ["customerId", "channel"],
            where: pageWhere,
            _count: { _all: true },
          }),
          prisma.company.findMany({
            where: { workspaceId: auth.workspaceId, id: { in: customerIds } },
            select: customerSelect,
          }),
          Promise.all(
            customerIds.map((customerId) =>
              prisma.communication.findFirst({
                where: { workspaceId: auth.workspaceId, customerId },
                include: communicationInclude,
                orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
              }),
            ),
          ),
        ]);

      const customerById = new Map(
        customers.map((customer) => [customer.id, customer] as const),
      );
      const unreadById = new Map<string, number>();
      for (const group of unreadGroups) {
        if (group.customerId)
          unreadById.set(group.customerId, group._count._all);
      }
      const channelOrder = new Map<CommunicationChannel, number>(
        COMMUNICATION_CHANNELS.map(
          (channel, index) => [channel, index] as const,
        ),
      );
      const channelsById = new Map<string, CommunicationChannel[]>();
      for (const group of channelGroups) {
        if (!group.customerId) continue;
        const existing = channelsById.get(group.customerId) ?? [];
        existing.push(group.channel as CommunicationChannel);
        channelsById.set(group.customerId, existing);
      }

      const threads: CommunicationThread[] = [];
      groups.forEach((group, index) => {
        if (!group.customerId) return;
        const customer = customerById.get(group.customerId);
        const lastMessage = lastMessages[index];
        if (!customer || !lastMessage) return;
        const channels = (channelsById.get(group.customerId) ?? []).sort(
          (a, b) => (channelOrder.get(a) ?? 0) - (channelOrder.get(b) ?? 0),
        );
        threads.push({
          customer: toCustomerSummary(customer),
          lastMessage: toCommunication(lastMessage),
          messageCount: group._count._all,
          unreadCount: unreadById.get(group.customerId) ?? 0,
          channels,
        });
      });

      return threads.sort((a, b) => {
        const diff =
          Date.parse(b.lastMessage.occurredAt) -
          Date.parse(a.lastMessage.occurredAt);
        if (diff !== 0) return diff;
        return a.lastMessage.id < b.lastMessage.id
          ? 1
          : a.lastMessage.id > b.lastMessage.id
            ? -1
            : 0;
      });
    },
  );

  app.get(
    "/communications/stats",
    {
      preHandler: authenticate,
      schema: {
        tags: ["communications"],
        summary: "Inbox totals by channel, direction and unread state",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<CommunicationStats> => {
      const auth = getAuth(request);
      const workspace = await prisma.workspace.findUnique({
        where: { id: auth.workspaceId },
        select: { timezone: true },
      });
      if (!workspace) throw notFound("Workspace");

      const dayStart = startOfDayInTimeZone(new Date(), workspace.timezone);
      const scope = { workspaceId: auth.workspaceId };

      const [
        total,
        calls,
        texts,
        emails,
        inbound,
        outbound,
        unread,
        callsToday,
        textsToday,
        followUpsOpen,
      ] = await Promise.all([
        prisma.communication.count({ where: scope }),
        prisma.communication.count({ where: { ...scope, channel: "CALL" } }),
        prisma.communication.count({ where: { ...scope, channel: "SMS" } }),
        prisma.communication.count({ where: { ...scope, channel: "EMAIL" } }),
        prisma.communication.count({
          where: { ...scope, direction: "INBOUND" },
        }),
        prisma.communication.count({
          where: { ...scope, direction: "OUTBOUND" },
        }),
        prisma.communication.count({
          where: { ...scope, direction: "INBOUND", readAt: null },
        }),
        prisma.communication.count({
          where: { ...scope, channel: "CALL", occurredAt: { gte: dayStart } },
        }),
        prisma.communication.count({
          where: { ...scope, channel: "SMS", occurredAt: { gte: dayStart } },
        }),
        prisma.activity.count({
          where: {
            workspaceId: auth.workspaceId,
            type: "TASK",
            completedAt: null,
          },
        }),
      ]);

      return {
        total,
        calls,
        texts,
        emails,
        inbound,
        outbound,
        unread,
        callsToday,
        textsToday,
        followUpsOpen,
      };
    },
  );

  app.post(
    "/communications/draft",
    {
      preHandler: authenticate,
      schema: {
        tags: ["communications"],
        summary: "Build a local message draft for a customer",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const input = parseOrThrow(communicationDraftInputSchema, request.body);

      const [workspace, customer] = await Promise.all([
        prisma.workspace.findUnique({
          where: { id: auth.workspaceId },
          select: {
            name: true,
            currency: true,
            timezone: true,
            businessType: true,
            serviceArea: true,
          },
        }),
        prisma.company.findFirst({
          where: { id: input.customerId, workspaceId: auth.workspaceId },
          select: {
            id: true,
            name: true,
            contacts: {
              where: { archived: false },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              take: 1,
              select: { firstName: true, lastName: true },
            },
          },
        }),
      ]);
      if (!workspace) throw notFound("Workspace");
      if (!customer) throw notFound("Customer");

      const job = input.jobId
        ? await prisma.job.findFirst({
            where: {
              id: input.jobId,
              workspaceId: auth.workspaceId,
              customerId: customer.id,
            },
            select: {
              number: true,
              title: true,
              scheduledStart: true,
              contact: { select: { firstName: true, lastName: true } },
              lineItems: {
                orderBy: { position: "asc" },
                take: 1,
                select: { name: true, service: { select: { name: true } } },
              },
            },
          })
        : null;
      if (input.jobId && !job) throw notFound("Job");

      const openInvoices = await prisma.invoice.findMany({
        where: {
          workspaceId: auth.workspaceId,
          customerId: customer.id,
          status: { notIn: ["PAID", "VOID", "DRAFT"] },
        },
        select: { amount: true, amountPaid: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 25,
      });
      const balance = openInvoices.reduce(
        (sum, invoice) =>
          sum + Math.max(0, invoice.amount - invoice.amountPaid),
        0,
      );

      const lineItem = job?.lineItems[0] ?? null;
      const jobContactName = job?.contact
        ? `${job.contact.firstName} ${job.contact.lastName}`.trim()
        : null;
      const primaryContact = customer.contacts[0];
      const contactName =
        jobContactName ??
        (primaryContact
          ? `${primaryContact.firstName} ${primaryContact.lastName}`.trim()
          : null);

      return buildMessageDraft({
        customerName: customer.name,
        contactName,
        businessName: workspace.name,
        businessTypeLabel:
          BUSINESS_TYPE_META[workspace.businessType as BusinessType]?.label ??
          "Home services",
        channel: input.channel,
        intent: input.intent,
        tone: input.tone,
        appointmentLabel: job?.scheduledStart
          ? formatAppointment(job.scheduledStart, workspace.timezone)
          : null,
        jobNumber: job?.number ?? null,
        serviceName:
          lineItem?.service?.name ?? lineItem?.name ?? job?.title ?? null,
        amountLabel:
          balance > 0 ? formatMoney(balance, workspace.currency) : null,
        serviceArea: workspace.serviceArea,
      });
    },
  );

  app.get(
    "/communications/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["communications"],
        summary: "Fetch a single communication",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      return toCommunication(await loadCommunication(auth.workspaceId, id));
    },
  );

  app.post(
    "/communications",
    {
      preHandler: authenticate,
      schema: {
        tags: ["communications"],
        summary: "Log a call, text or email",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const input = parseOrThrow(communicationSendDraftSchema, request.body);

      const [contact, job] = await Promise.all([
        input.contactId
          ? prisma.contact.findFirst({
              where: { id: input.contactId, workspaceId: auth.workspaceId },
              select: { id: true, companyId: true },
            })
          : null,
        input.jobId
          ? prisma.job.findFirst({
              where: { id: input.jobId, workspaceId: auth.workspaceId },
              select: { id: true, customerId: true },
            })
          : null,
      ]);
      if (input.contactId && !contact) throw notFound("Contact");
      if (input.jobId && !job) throw notFound("Job");

      let customerId = input.customerId ?? null;
      if (!customerId) {
        customerId = contact?.companyId ?? job?.customerId ?? null;
      }

      if (customerId) {
        const customer = await prisma.company.findFirst({
          where: { id: customerId, workspaceId: auth.workspaceId },
          select: { id: true },
        });
        if (!customer) throw notFound("Customer");
        if (contact?.companyId && contact.companyId !== customerId) {
          throw badRequest("Contact does not belong to that customer");
        }
        if (job && job.customerId !== customerId) {
          throw badRequest("Job does not belong to that customer");
        }
      }

      const direction = input.direction as CommunicationDirection;
      const channel = input.channel as CommunicationChannel;
      const status: CommunicationStatus =
        input.status ??
        (direction === "INBOUND"
          ? "RECEIVED"
          : channel === "CALL"
            ? "LOGGED"
            : "SENT");

      const created = await prisma.communication.create({
        data: {
          workspaceId: auth.workspaceId,
          channel,
          direction,
          status,
          intent: input.intent,
          sentiment: input.sentiment,
          subject: input.subject ?? null,
          body: input.body ?? null,
          customerId,
          contactId: input.contactId ?? null,
          jobId: input.jobId ?? null,
          userId: auth.userId,
          provider: "log",
          externalId: null,
          aiGenerated: input.aiGenerated,
          aiRationale: input.aiRationale ?? null,
          readAt: null,
          occurredAt: input.occurredAt ?? new Date(),
        },
        include: communicationInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "communication.logged",
        entityType: "communication",
        entityId: created.id,
        metadata: {
          channel,
          direction,
          status,
          customerId,
          contactId: created.contactId,
          jobId: created.jobId,
        },
      });

      return reply.status(201).send(toCommunication(created));
    },
  );

  app.patch(
    "/communications/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["communications"],
        summary: "Mark a communication read or set its sentiment",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadCommunication(auth.workspaceId, id);
      const input = parseOrThrow(communicationPatchSchema, request.body);

      const data: Prisma.CommunicationUpdateInput = {};
      if (input.readAt !== undefined) data.readAt = input.readAt ?? null;
      if (input.sentiment !== undefined) data.sentiment = input.sentiment;

      const updated =
        Object.keys(data).length > 0
          ? await prisma.communication.update({
              where: { id: existing.id },
              data,
              include: communicationInclude,
            })
          : existing;

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "communication.updated",
        entityType: "communication",
        entityId: existing.id,
        metadata: {
          readAt: input.readAt !== undefined ? iso(input.readAt) : undefined,
          sentiment: input.sentiment,
        },
      });

      return toCommunication(updated);
    },
  );

  app.delete(
    "/communications/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["communications"],
        summary: "Delete a communication",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadCommunication(auth.workspaceId, id);
      await requireRole(request, "ADMIN");
      await prisma.communication.delete({ where: { id: existing.id } });
      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "communication.deleted",
        entityType: "communication",
        entityId: existing.id,
        metadata: { channel: existing.channel, direction: existing.direction },
      });
      return reply.status(204).send();
    },
  );
}
