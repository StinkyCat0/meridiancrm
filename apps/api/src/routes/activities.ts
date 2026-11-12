import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ACTIVITY_TYPES,
  activityInputSchema,
  activityPatchSchema,
  idSchema,
  paginationSchema,
  type Activity,
  type ActivityType,
  type PublicUser,
} from "@meridian/contracts";
import type { Prisma } from "@prisma/client";
import { authenticate, getAuth } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/db.js";
import { likeTerm, notFound, pageMeta, parseOrThrow } from "../lib/http.js";

const DAY_MS = 86_400_000;

const userSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

export const activityInclude = {
  contact: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  company: { select: { id: true, name: true, domain: true } },
  deal: { select: { id: true, title: true } },
  owner: { select: userSelect },
} satisfies Prisma.ActivityInclude;

export type ActivityWithRelations = Prisma.ActivityGetPayload<{
  include: typeof activityInclude;
}>;

const listQuerySchema = paginationSchema.extend({
  type: z.enum(ACTIVITY_TYPES).optional(),
  completed: z.enum(["true", "false"]).optional(),
  due: z.enum(["overdue", "today", "week", "all"]).default("all"),
  contactId: idSchema.optional(),
  companyId: idSchema.optional(),
  dealId: idSchema.optional(),
});

const idParamsSchema = z.object({ id: idSchema });

function toPublicUser(user: PublicUser | null | undefined): PublicUser | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

export function toActivity(row: ActivityWithRelations): Activity {
  return {
    id: row.id,
    type: row.type as ActivityType,
    title: row.title,
    body: row.body,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    contact: row.contact
      ? {
          id: row.contact.id,
          firstName: row.contact.firstName,
          lastName: row.contact.lastName,
          email: row.contact.email,
        }
      : null,
    company: row.company
      ? {
          id: row.company.id,
          name: row.company.name,
          domain: row.company.domain,
        }
      : null,
    dealId: row.dealId,
    dealTitle: row.deal ? row.deal.title : null,
    owner: toPublicUser(row.owner),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function activityOrder(
  sort: string | undefined,
  order: "asc" | "desc",
): Prisma.ActivityOrderByWithRelationInput {
  switch (sort) {
    case "dueAt":
      return { dueAt: order };
    case "updatedAt":
      return { updatedAt: order };
    case "createdAt":
      return { createdAt: order };
    default:
      return { createdAt: order };
  }
}

async function requireContact(
  workspaceId: string,
  contactId: string,
): Promise<void> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { id: true },
  });
  if (!contact) throw notFound("Contact");
}

async function requireCompany(
  workspaceId: string,
  companyId: string,
): Promise<void> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, workspaceId },
    select: { id: true },
  });
  if (!company) throw notFound("Company");
}

async function requireDeal(workspaceId: string, dealId: string): Promise<void> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, workspaceId },
    select: { id: true },
  });
  if (!deal) throw notFound("Deal");
}

async function loadActivity(
  workspaceId: string,
  id: string,
): Promise<ActivityWithRelations> {
  const row = await prisma.activity.findFirst({
    where: { id, workspaceId },
    include: activityInclude,
  });
  if (!row) throw notFound("Activity");
  return row;
}

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/activities",
    {
      preHandler: authenticate,
      schema: {
        tags: ["activities"],
        summary: "List activities with type, completion and due-date filters",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(listQuerySchema, request.query);
      const now = new Date();

      const where: Prisma.ActivityWhereInput = {
        workspaceId: auth.workspaceId,
        ...(query.type ? { type: query.type } : {}),
        ...(query.contactId ? { contactId: query.contactId } : {}),
        ...(query.companyId ? { companyId: query.companyId } : {}),
        ...(query.dealId ? { dealId: query.dealId } : {}),
        ...(query.q ? { title: { contains: likeTerm(query.q) } } : {}),
      };

      if (query.completed === "true") where.completedAt = { not: null };
      else if (query.completed === "false") where.completedAt = null;

      if (query.due !== "all") {
        where.completedAt = null;
        if (query.due === "overdue") {
          where.dueAt = { lt: now };
        } else {
          const startOfDay = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
          );
          if (query.due === "today") {
            where.dueAt = {
              gte: startOfDay,
              lt: new Date(startOfDay.getTime() + DAY_MS),
            };
          } else {
            where.dueAt = {
              gte: startOfDay,
              lte: new Date(now.getTime() + 7 * DAY_MS),
            };
          }
        }
      }

      const [total, rows] = await Promise.all([
        prisma.activity.count({ where }),
        prisma.activity.findMany({
          where,
          include: activityInclude,
          orderBy: activityOrder(query.sort, query.order),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      return {
        data: rows.map(toActivity),
        meta: pageMeta(total, query.page, query.pageSize),
      };
    },
  );

  app.post(
    "/activities",
    {
      preHandler: authenticate,
      schema: {
        tags: ["activities"],
        summary: "Log an activity",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const input = parseOrThrow(activityInputSchema, request.body);
      if (input.contactId)
        await requireContact(auth.workspaceId, input.contactId);
      if (input.companyId)
        await requireCompany(auth.workspaceId, input.companyId);
      if (input.dealId) await requireDeal(auth.workspaceId, input.dealId);

      const created = await prisma.activity.create({
        data: {
          workspaceId: auth.workspaceId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          dueAt: input.dueAt ?? null,
          completedAt: input.completedAt ?? null,
          contactId: input.contactId ?? null,
          companyId: input.companyId ?? null,
          dealId: input.dealId ?? null,
          ownerId: auth.userId,
        },
        include: activityInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "activity.created",
        entityType: "activity",
        entityId: created.id,
        metadata: { type: created.type, title: created.title },
      });

      return reply.status(201).send(toActivity(created));
    },
  );

  app.patch(
    "/activities/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["activities"],
        summary: "Update an activity (completedAt: null reopens it)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadActivity(auth.workspaceId, id);
      const input = parseOrThrow(activityPatchSchema, request.body);

      const data: Prisma.ActivityUncheckedUpdateInput = {};
      if (input.type !== undefined) data.type = input.type;
      if (input.title !== undefined) data.title = input.title;
      if (input.body !== undefined) data.body = input.body ?? null;
      if (input.dueAt !== undefined) data.dueAt = input.dueAt ?? null;
      if (input.completedAt !== undefined)
        data.completedAt = input.completedAt ?? null;
      if (input.contactId !== undefined) {
        if (input.contactId)
          await requireContact(auth.workspaceId, input.contactId);
        data.contactId = input.contactId ?? null;
      }
      if (input.companyId !== undefined) {
        if (input.companyId)
          await requireCompany(auth.workspaceId, input.companyId);
        data.companyId = input.companyId ?? null;
      }
      if (input.dealId !== undefined) {
        if (input.dealId) await requireDeal(auth.workspaceId, input.dealId);
        data.dealId = input.dealId ?? null;
      }

      const updated = await prisma.activity.update({
        where: { id: existing.id },
        data,
        include: activityInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "activity.updated",
        entityType: "activity",
        entityId: updated.id,
      });

      return toActivity(updated);
    },
  );

  app.delete(
    "/activities/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["activities"],
        summary: "Delete an activity",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadActivity(auth.workspaceId, id);

      await prisma.activity.delete({ where: { id: existing.id } });
      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "activity.deleted",
        entityType: "activity",
        entityId: existing.id,
      });

      return reply.status(204).send();
    },
  );
}
