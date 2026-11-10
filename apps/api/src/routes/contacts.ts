import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  contactInputSchema,
  idSchema,
  paginationSchema,
  type Contact,
  type PublicUser,
} from "@meridian/contracts";
import type { Prisma } from "@prisma/client";
import { authenticate, getAuth, requireRole } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/db.js";
import { badRequest, likeTerm, notFound, pageMeta, parseOrThrow, parseTags, serializeTags } from "../lib/http.js";

const userSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

const contactInclude = {
  company: { select: { id: true, name: true, domain: true } },
  owner: { select: userSelect },
} satisfies Prisma.ContactInclude;

type ContactRow = Prisma.ContactGetPayload<{ include: typeof contactInclude }>;

const listQuerySchema = paginationSchema.extend({
  archive: z.enum(["active", "archived", "all"]).default("active"),
  companyId: idSchema.optional(),
});

const idParamsSchema = z.object({ id: idSchema });

const deleteQuerySchema = z.object({
  permanent: z.enum(["true", "false"]).optional(),
});

function toPublicUser(user: PublicUser | null | undefined): PublicUser | null {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
}

function toContact(row: ContactRow, lastActivityAt: Date | null, openDealCount: number): Contact {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    title: row.title,
    company: row.company
      ? { id: row.company.id, name: row.company.name, domain: row.company.domain }
      : null,
    owner: toPublicUser(row.owner),
    tags: parseTags(row.tags),
    archived: row.archived,
    lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
    openDealCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function archiveFilter(archive: "active" | "archived" | "all"): { archived?: boolean } {
  if (archive === "all") return {};
  return { archived: archive === "archived" };
}

function contactOrder(
  sort: string | undefined,
  order: "asc" | "desc",
): Prisma.ContactOrderByWithRelationInput {
  switch (sort) {
    case "firstName":
      return { firstName: order };
    case "lastName":
      return { lastName: order };
    case "updatedAt":
      return { updatedAt: order };
    case "createdAt":
      return { createdAt: order };
    default:
      return { createdAt: order };
  }
}

async function lastActivityByContact(
  workspaceId: string,
  contactIds: string[],
): Promise<Map<string, Date | null>> {
  const result = new Map<string, Date | null>();
  if (!contactIds.length) return result;
  const rows = await prisma.activity.groupBy({
    by: ["contactId"],
    where: { workspaceId, contactId: { in: contactIds } },
    _max: { createdAt: true },
  });
  for (const row of rows) {
    if (!row.contactId) continue;
    result.set(row.contactId, row._max.createdAt);
  }
  return result;
}

async function openDealCountByContact(
  workspaceId: string,
  contactIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!contactIds.length) return result;
  const rows = await prisma.deal.findMany({
    where: { workspaceId, contactId: { in: contactIds }, stage: { kind: "OPEN" } },
    select: { contactId: true },
  });
  for (const row of rows) {
    if (!row.contactId) continue;
    result.set(row.contactId, (result.get(row.contactId) ?? 0) + 1);
  }
  return result;
}

async function resolveOwnerId(
  workspaceId: string,
  requested: string | null | undefined,
  fallback: string,
): Promise<string | null> {
  if (requested === undefined) return fallback;
  if (requested === null) return null;
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: requested, workspaceId } },
    select: { id: true },
  });
  if (!membership) throw badRequest("Owner must be a member of this workspace");
  return requested;
}

async function requireCompany(workspaceId: string, companyId: string): Promise<void> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, workspaceId },
    select: { id: true },
  });
  if (!company) throw notFound("Company");
}

async function loadContact(workspaceId: string, id: string): Promise<ContactRow> {
  const row = await prisma.contact.findFirst({ where: { id, workspaceId }, include: contactInclude });
  if (!row) throw notFound("Contact");
  return row;
}

async function serializeContact(workspaceId: string, row: ContactRow): Promise<Contact> {
  const [lastActivity, openDeals] = await Promise.all([
    lastActivityByContact(workspaceId, [row.id]),
    openDealCountByContact(workspaceId, [row.id]),
  ]);
  return toContact(row, lastActivity.get(row.id) ?? null, openDeals.get(row.id) ?? 0);
}

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/contacts",
    {
      preHandler: authenticate,
      schema: {
        tags: ["contacts"],
        summary: "List contacts with filters and pagination",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(listQuerySchema, request.query);
      const where: Prisma.ContactWhereInput = {
        workspaceId: auth.workspaceId,
        ...archiveFilter(query.archive),
        ...(query.companyId ? { companyId: query.companyId } : {}),
        ...(query.q
          ? {
              OR: [
                { firstName: { contains: likeTerm(query.q) } },
                { lastName: { contains: likeTerm(query.q) } },
                { email: { contains: likeTerm(query.q) } },
              ],
            }
          : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.contact.count({ where }),
        prisma.contact.findMany({
          where,
          include: contactInclude,
          orderBy: contactOrder(query.sort, query.order),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      const ids = rows.map((row) => row.id);
      const [lastActivity, openDeals] = await Promise.all([
        lastActivityByContact(auth.workspaceId, ids),
        openDealCountByContact(auth.workspaceId, ids),
      ]);

      return {
        data: rows.map((row) =>
          toContact(row, lastActivity.get(row.id) ?? null, openDeals.get(row.id) ?? 0),
        ),
        meta: pageMeta(total, query.page, query.pageSize),
      };
    },
  );

  app.post(
    "/contacts",
    {
      preHandler: authenticate,
      schema: {
        tags: ["contacts"],
        summary: "Create a contact",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const input = parseOrThrow(contactInputSchema, request.body);
      if (input.companyId) await requireCompany(auth.workspaceId, input.companyId);
      const ownerId = await resolveOwnerId(auth.workspaceId, input.ownerId, auth.userId);

      const created = await prisma.contact.create({
        data: {
          workspaceId: auth.workspaceId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email ?? null,
          phone: input.phone ?? null,
          title: input.title ?? null,
          companyId: input.companyId ?? null,
          tags: serializeTags(input.tags) ?? "[]",
          archived: input.archived ?? false,
          ownerId,
        },
        include: contactInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "contact.created",
        entityType: "contact",
        entityId: created.id,
        metadata: { name: `${created.firstName} ${created.lastName}` },
      });

      return reply.status(201).send(toContact(created, null, 0));
    },
  );

  app.get(
    "/contacts/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["contacts"],
        summary: "Fetch a single contact",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      return serializeContact(auth.workspaceId, await loadContact(auth.workspaceId, id));
    },
  );

  app.patch(
    "/contacts/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["contacts"],
        summary: "Update a contact",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadContact(auth.workspaceId, id);
      const input = parseOrThrow(contactInputSchema.partial(), request.body);

      const data: Prisma.ContactUncheckedUpdateInput = {};
      if (input.firstName !== undefined) data.firstName = input.firstName;
      if (input.lastName !== undefined) data.lastName = input.lastName;
      if (input.email !== undefined) data.email = input.email ?? null;
      if (input.phone !== undefined) data.phone = input.phone ?? null;
      if (input.title !== undefined) data.title = input.title ?? null;
      if (input.companyId !== undefined) {
        if (input.companyId) await requireCompany(auth.workspaceId, input.companyId);
        data.companyId = input.companyId ?? null;
      }
      if (input.tags !== undefined) data.tags = serializeTags(input.tags) ?? "[]";
      if (input.archived !== undefined) data.archived = input.archived;
      if (input.ownerId !== undefined) {
        data.ownerId = await resolveOwnerId(auth.workspaceId, input.ownerId, auth.userId);
      }

      const updated = await prisma.contact.update({
        where: { id: existing.id },
        data,
        include: contactInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "contact.updated",
        entityType: "contact",
        entityId: updated.id,
      });

      return serializeContact(auth.workspaceId, updated);
    },
  );

  app.post(
    "/contacts/:id/restore",
    {
      preHandler: authenticate,
      schema: {
        tags: ["contacts"],
        summary: "Restore an archived contact",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadContact(auth.workspaceId, id);
      const restored = await prisma.contact.update({
        where: { id: existing.id },
        data: { archived: false },
        include: contactInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "contact.restored",
        entityType: "contact",
        entityId: restored.id,
      });

      return serializeContact(auth.workspaceId, restored);
    },
  );

  app.delete(
    "/contacts/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["contacts"],
        summary: "Archive a contact (permanent delete for admins)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadContact(auth.workspaceId, id);
      const { permanent } = parseOrThrow(deleteQuerySchema, request.query);

      if (permanent === "true") {
        await requireRole(request, "ADMIN");
        await prisma.contact.delete({ where: { id: existing.id } });
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "contact.deleted",
          entityType: "contact",
          entityId: existing.id,
          metadata: { name: `${existing.firstName} ${existing.lastName}` },
        });
      } else {
        await prisma.contact.update({ where: { id: existing.id }, data: { archived: true } });
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "contact.archived",
          entityType: "contact",
          entityId: existing.id,
        });
      }

      return reply.status(204).send();
    },
  );
}
