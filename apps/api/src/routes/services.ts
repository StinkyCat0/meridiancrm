import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  SERVICE_UNITS,
  paginationSchema,
  serviceInputSchema,
  servicePatchSchema,
  type ServiceItem,
  type ServiceUnit,
} from "@meridian/contracts";
import type { Prisma } from "@prisma/client";
import { authenticate, getAuth, requireRole } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/db.js";
import { likeTerm, notFound, pageMeta, parseOrThrow } from "../lib/http.js";

const include = {
  _count: { select: { jobLines: true, estimateLines: true } },
} satisfies Prisma.ServiceItemInclude;

type ServiceRow = Prisma.ServiceItemGetPayload<{ include: typeof include }>;

const listQuerySchema = paginationSchema.extend({
  archive: z.enum(["active", "archived", "all"]).default("active"),
  category: z.string().trim().max(80).optional(),
  unit: z.enum(SERVICE_UNITS).optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1).max(64) });
const deleteQuerySchema = z.object({ permanent: z.enum(["true", "false"]).optional() });

function toService(row: ServiceRow): ServiceItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    unit: row.unit as ServiceUnit,
    durationMinutes: row.durationMinutes,
    price: row.price,
    cost: row.cost,
    taxable: row.taxable,
    archived: row.archived,
    usageCount: row._count.jobLines + row._count.estimateLines,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadService(workspaceId: string, id: string): Promise<ServiceRow> {
  const row = await prisma.serviceItem.findFirst({
    where: { id, workspaceId },
    include,
  });
  if (!row) throw notFound("Service");
  return row;
}

export async function serviceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/services",
    {
      preHandler: authenticate,
      schema: {
        tags: ["services"],
        summary: "List the service price book",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(listQuerySchema, request.query);
      const where: Prisma.ServiceItemWhereInput = {
        workspaceId: auth.workspaceId,
        ...(query.archive === "all" ? {} : { archived: query.archive === "archived" }),
        ...(query.category ? { category: query.category } : {}),
        ...(query.unit ? { unit: query.unit } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: likeTerm(query.q) } },
                { category: { contains: likeTerm(query.q) } },
                { description: { contains: likeTerm(query.q) } },
              ],
            }
          : {}),
      };

      const orderBy: Prisma.ServiceItemOrderByWithRelationInput =
        query.sort === "price"
          ? { price: query.order }
          : query.sort === "category"
            ? { category: query.order }
            : { name: query.order };

      const [total, rows] = await Promise.all([
        prisma.serviceItem.count({ where }),
        prisma.serviceItem.findMany({
          where,
          include,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      return {
        data: rows.map(toService),
        meta: pageMeta(total, query.page, query.pageSize),
      };
    },
  );

  app.post(
    "/services",
    {
      preHandler: authenticate,
      schema: {
        tags: ["services"],
        summary: "Add a service to the price book",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const input = parseOrThrow(serviceInputSchema, request.body);
      const created = await prisma.serviceItem.create({
        data: {
          workspaceId: auth.workspaceId,
          name: input.name,
          category: input.category ?? null,
          description: input.description ?? null,
          unit: input.unit,
          durationMinutes: input.durationMinutes,
          price: input.price,
          taxable: input.taxable,
          archived: input.archived ?? false,
        },
        include,
      });
      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "service.created",
        entityType: "service",
        entityId: created.id,
        metadata: { name: created.name },
      });
      return reply.status(201).send(toService(created));
    },
  );

  app.get(
    "/services/:id",
    {
      preHandler: authenticate,
      schema: { tags: ["services"], summary: "Fetch a service", security: [{ bearerAuth: [] }] },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      return toService(await loadService(auth.workspaceId, id));
    },
  );

  app.patch(
    "/services/:id",
    {
      preHandler: authenticate,
      schema: { tags: ["services"], summary: "Update a service", security: [{ bearerAuth: [] }] },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadService(auth.workspaceId, id);
      const input = parseOrThrow(servicePatchSchema, request.body);

      const data: Prisma.ServiceItemUncheckedUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.category !== undefined) data.category = input.category ?? null;
      if (input.description !== undefined) data.description = input.description ?? null;
      if (input.unit !== undefined) data.unit = input.unit;
      if (input.durationMinutes !== undefined) data.durationMinutes = input.durationMinutes;
      if (input.price !== undefined) data.price = input.price;
      if (input.taxable !== undefined) data.taxable = input.taxable;
      if (input.archived !== undefined) data.archived = input.archived;

      const updated = await prisma.serviceItem.update({
        where: { id: existing.id },
        data,
        include,
      });
      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "service.updated",
        entityType: "service",
        entityId: updated.id,
      });
      return toService(updated);
    },
  );

  app.post(
    "/services/:id/restore",
    {
      preHandler: authenticate,
      schema: { tags: ["services"], summary: "Restore a service", security: [{ bearerAuth: [] }] },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadService(auth.workspaceId, id);
      const restored = await prisma.serviceItem.update({
        where: { id: existing.id },
        data: { archived: false },
        include,
      });
      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "service.restored",
        entityType: "service",
        entityId: restored.id,
      });
      return toService(restored);
    },
  );

  app.delete(
    "/services/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["services"],
        summary: "Archive a service (permanent delete for admins)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadService(auth.workspaceId, id);
      const { permanent } = parseOrThrow(deleteQuerySchema, request.query);
      if (permanent === "true") {
        await requireRole(request, "ADMIN");
        await prisma.serviceItem.delete({ where: { id: existing.id } });
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "service.deleted",
          entityType: "service",
          entityId: existing.id,
          metadata: { name: existing.name },
        });
      } else {
        await prisma.serviceItem.update({ where: { id: existing.id }, data: { archived: true } });
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "service.archived",
          entityType: "service",
          entityId: existing.id,
        });
      }
      return reply.status(204).send();
    },
  );
}
