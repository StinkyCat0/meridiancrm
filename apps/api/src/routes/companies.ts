import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CUSTOMER_TYPES,
  INDUSTRIES,
  companyInputSchema,
  idSchema,
  paginationSchema,
  type Company,
  type CustomerType,
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

const companyInclude = {
  owner: { select: userSelect },
  _count: {
    select: {
      contacts: { where: { archived: false } },
      deals: true,
      locations: { where: { archived: false } },
      jobs: { where: { status: { in: ["UNSCHEDULED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS"] } } },
    },
  },
} satisfies Prisma.CompanyInclude;

type CompanyRow = Prisma.CompanyGetPayload<{ include: typeof companyInclude }>;

const listQuerySchema = paginationSchema.extend({
  archive: z.enum(["active", "archived", "all"]).default("active"),
  industry: z.enum(INDUSTRIES).optional(),
  customerType: z.enum(CUSTOMER_TYPES).optional(),
});

const idParamsSchema = z.object({ id: idSchema });

const deleteQuerySchema = z.object({
  permanent: z.enum(["true", "false"]).optional(),
});

function toPublicUser(user: PublicUser | null | undefined): PublicUser | null {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
}

function toCompany(row: CompanyRow, openPipelineValue: number): Company {
  return {
    id: row.id,
    name: row.name,
    customerType: row.customerType as CustomerType,
    domain: row.domain,
    industry: row.industry,
    size: row.size,
    phone: row.phone,
    email: row.email,
    website: row.website,
    address: row.address,
    notes: row.notes,
    tags: parseTags(row.tags),
    archived: row.archived,
    owner: toPublicUser(row.owner),
    contactCount: row._count.contacts,
    locationCount: row._count.locations,
    openJobCount: row._count.jobs,
    dealCount: row._count.deals,
    openPipelineValue,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function archiveFilter(archive: "active" | "archived" | "all"): { archived?: boolean } {
  if (archive === "all") return {};
  return { archived: archive === "archived" };
}

function companyOrder(
  sort: string | undefined,
  order: "asc" | "desc",
): Prisma.CompanyOrderByWithRelationInput {
  switch (sort) {
    case "name":
      return { name: order };
    case "updatedAt":
      return { updatedAt: order };
    case "createdAt":
      return { createdAt: order };
    default:
      return { createdAt: order };
  }
}

async function openPipelineByCompany(
  workspaceId: string,
  companyIds: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (!companyIds.length) return totals;
  const rows = await prisma.deal.findMany({
    where: { workspaceId, companyId: { in: companyIds }, stage: { kind: "OPEN" } },
    select: { companyId: true, value: true },
  });
  for (const row of rows) {
    if (!row.companyId) continue;
    totals.set(row.companyId, (totals.get(row.companyId) ?? 0) + row.value);
  }
  return totals;
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

async function loadCompany(workspaceId: string, id: string): Promise<CompanyRow> {
  const row = await prisma.company.findFirst({ where: { id, workspaceId }, include: companyInclude });
  if (!row) throw notFound("Company");
  return row;
}

async function serializeWithPipeline(workspaceId: string, row: CompanyRow): Promise<Company> {
  const totals = await openPipelineByCompany(workspaceId, [row.id]);
  return toCompany(row, totals.get(row.id) ?? 0);
}

export async function companyRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/companies",
    {
      preHandler: authenticate,
      schema: {
        tags: ["companies"],
        summary: "List companies with filters, counts and pagination",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(listQuerySchema, request.query);
      const where: Prisma.CompanyWhereInput = {
        workspaceId: auth.workspaceId,
        ...archiveFilter(query.archive),
        ...(query.industry ? { industry: query.industry } : {}),
        ...(query.customerType ? { customerType: query.customerType } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: likeTerm(query.q) } },
                { domain: { contains: likeTerm(query.q) } },
                { phone: { contains: likeTerm(query.q) } },
                { email: { contains: likeTerm(query.q) } },
              ],
            }
          : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.company.count({ where }),
        prisma.company.findMany({
          where,
          include: companyInclude,
          orderBy: companyOrder(query.sort, query.order),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      const pipeline = await openPipelineByCompany(auth.workspaceId, rows.map((row) => row.id));
      return {
        data: rows.map((row) => toCompany(row, pipeline.get(row.id) ?? 0)),
        meta: pageMeta(total, query.page, query.pageSize),
      };
    },
  );

  app.post(
    "/companies",
    {
      preHandler: authenticate,
      schema: {
        tags: ["companies"],
        summary: "Create a company",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const input = parseOrThrow(companyInputSchema, request.body);
      const ownerId = await resolveOwnerId(auth.workspaceId, input.ownerId, auth.userId);

      const created = await prisma.company.create({
        data: {
          workspaceId: auth.workspaceId,
          name: input.name,
          customerType: input.customerType,
          domain: input.domain ?? null,
          industry: input.industry ?? null,
          size: input.size ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          website: input.website ?? null,
          address: input.address ?? null,
          notes: input.notes ?? null,
          tags: serializeTags(input.tags) ?? "[]",
          archived: input.archived ?? false,
          ownerId,
        },
        include: companyInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "company.created",
        entityType: "company",
        entityId: created.id,
        metadata: { name: created.name },
      });

      return reply.status(201).send(toCompany(created, 0));
    },
  );

  app.get(
    "/companies/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["companies"],
        summary: "Fetch a single company",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const row = await loadCompany(auth.workspaceId, id);
      return serializeWithPipeline(auth.workspaceId, row);
    },
  );

  app.patch(
    "/companies/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["companies"],
        summary: "Update a company",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadCompany(auth.workspaceId, id);
      const input = parseOrThrow(companyInputSchema.partial(), request.body);

      const data: Prisma.CompanyUncheckedUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.customerType !== undefined) data.customerType = input.customerType;
      if (input.domain !== undefined) data.domain = input.domain ?? null;
      if (input.industry !== undefined) data.industry = input.industry ?? null;
      if (input.size !== undefined) data.size = input.size ?? null;
      if (input.phone !== undefined) data.phone = input.phone ?? null;
      if (input.email !== undefined) data.email = input.email ?? null;
      if (input.website !== undefined) data.website = input.website ?? null;
      if (input.address !== undefined) data.address = input.address ?? null;
      if (input.notes !== undefined) data.notes = input.notes ?? null;
      if (input.tags !== undefined) data.tags = serializeTags(input.tags) ?? "[]";
      if (input.archived !== undefined) data.archived = input.archived;
      if (input.ownerId !== undefined) {
        data.ownerId = await resolveOwnerId(auth.workspaceId, input.ownerId, auth.userId);
      }

      const updated = await prisma.company.update({
        where: { id: existing.id },
        data,
        include: companyInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "company.updated",
        entityType: "company",
        entityId: updated.id,
      });

      return serializeWithPipeline(auth.workspaceId, updated);
    },
  );

  app.post(
    "/companies/:id/restore",
    {
      preHandler: authenticate,
      schema: {
        tags: ["companies"],
        summary: "Restore an archived company",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadCompany(auth.workspaceId, id);
      const restored = await prisma.company.update({
        where: { id: existing.id },
        data: { archived: false },
        include: companyInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "company.restored",
        entityType: "company",
        entityId: restored.id,
      });

      return serializeWithPipeline(auth.workspaceId, restored);
    },
  );

  app.delete(
    "/companies/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["companies"],
        summary: "Archive a company (permanent delete for admins)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadCompany(auth.workspaceId, id);
      const { permanent } = parseOrThrow(deleteQuerySchema, request.query);

      if (permanent === "true") {
        await requireRole(request, "ADMIN");
        await prisma.company.delete({ where: { id: existing.id } });
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "company.deleted",
          entityType: "company",
          entityId: existing.id,
          metadata: { name: existing.name },
        });
      } else {
        await prisma.company.update({ where: { id: existing.id }, data: { archived: true } });
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "company.archived",
          entityType: "company",
          entityId: existing.id,
        });
      }

      return reply.status(204).send();
    },
  );
}
