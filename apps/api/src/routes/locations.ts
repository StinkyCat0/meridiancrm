import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  locationInputSchema,
  locationPatchSchema,
  paginationSchema,
  type Location,
} from "@meridian/contracts";
import type { Prisma } from "@prisma/client";
import { authenticate, getAuth, requireRole } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/db.js";
import {
  badRequest,
  likeTerm,
  notFound,
  pageMeta,
  parseOrThrow,
} from "../lib/http.js";
import {
  customerSelect,
  loadCustomer,
  toCustomerSummary,
} from "../lib/service-ops.js";

const include = {
  customer: { select: customerSelect },
  _count: {
    select: {
      jobs: { where: { status: { in: ["UNSCHEDULED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS"] } } },
    },
  },
} satisfies Prisma.LocationInclude;

type LocationRow = Prisma.LocationGetPayload<{ include: typeof include }>;

const listQuerySchema = paginationSchema.extend({
  customerId: z.string().trim().max(64).optional(),
  archive: z.enum(["active", "archived", "all"]).default("active"),
});

const idParamsSchema = z.object({ id: z.string().min(1).max(64) });
const deleteQuerySchema = z.object({ permanent: z.enum(["true", "false"]).optional() });

function toLocation(row: LocationRow): Location {
  return {
    id: row.id,
    customer: toCustomerSummary(row.customer),
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    accessNotes: row.accessNotes,
    gateCode: row.gateCode,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    latitude: row.latitude,
    longitude: row.longitude,
    isPrimary: row.isPrimary,
    archived: row.archived,
    openJobCount: row._count.jobs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadLocationRow(workspaceId: string, id: string): Promise<LocationRow> {
  const row = await prisma.location.findFirst({
    where: { id, workspaceId },
    include,
  });
  if (!row) throw notFound("Location");
  return row;
}

async function clearOtherPrimaries(workspaceId: string, customerId: string, keepId: string) {
  await prisma.location.updateMany({
    where: { workspaceId, customerId, isPrimary: true, id: { not: keepId } },
    data: { isPrimary: false },
  });
}

export async function locationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/locations",
    {
      preHandler: authenticate,
      schema: {
        tags: ["locations"],
        summary: "List service locations",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(listQuerySchema, request.query);
      const where: Prisma.LocationWhereInput = {
        workspaceId: auth.workspaceId,
        ...(query.archive === "all" ? {} : { archived: query.archive === "archived" }),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.q
          ? {
              OR: [
                { label: { contains: likeTerm(query.q) } },
                { line1: { contains: likeTerm(query.q) } },
                { city: { contains: likeTerm(query.q) } },
                { contactName: { contains: likeTerm(query.q) } },
              ],
            }
          : {}),
      };

      const orderBy: Prisma.LocationOrderByWithRelationInput =
        query.sort === "label" ? { label: query.order } : { updatedAt: query.order };

      const [total, rows] = await Promise.all([
        prisma.location.count({ where }),
        prisma.location.findMany({
          where,
          include,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      return {
        data: rows.map(toLocation),
        meta: pageMeta(total, query.page, query.pageSize),
      };
    },
  );

  app.post(
    "/locations",
    {
      preHandler: authenticate,
      schema: {
        tags: ["locations"],
        summary: "Add a service location to a customer",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const input = parseOrThrow(locationInputSchema, request.body);
      await loadCustomer(auth.workspaceId, input.customerId);

      const created = await prisma.location.create({
        data: {
          workspaceId: auth.workspaceId,
          customerId: input.customerId,
          label: input.label,
          line1: input.line1,
          line2: input.line2 ?? null,
          city: input.city,
          state: input.state ?? null,
          postalCode: input.postalCode ?? null,
          country: input.country ?? null,
          accessNotes: input.accessNotes ?? null,
          gateCode: input.gateCode ?? null,
          contactName: input.contactName ?? null,
          contactPhone: input.contactPhone ?? null,
          isPrimary: input.isPrimary ?? false,
          archived: input.archived ?? false,
        },
        include,
      });

      if (created.isPrimary) {
        await clearOtherPrimaries(auth.workspaceId, created.customerId, created.id);
      }

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "location.created",
        entityType: "location",
        entityId: created.id,
        metadata: { customerId: created.customerId, label: created.label },
      });

      return reply.status(201).send(toLocation(created));
    },
  );

  app.get(
    "/locations/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["locations"],
        summary: "Fetch a service location",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      return toLocation(await loadLocationRow(auth.workspaceId, id));
    },
  );

  app.patch(
    "/locations/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["locations"],
        summary: "Update a service location",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadLocationRow(auth.workspaceId, id);
      const input = parseOrThrow(locationPatchSchema, request.body);

      const data: Prisma.LocationUncheckedUpdateInput = {};
      if (input.label !== undefined) data.label = input.label;
      if (input.line1 !== undefined) data.line1 = input.line1;
      if (input.line2 !== undefined) data.line2 = input.line2 ?? null;
      if (input.city !== undefined) data.city = input.city;
      if (input.state !== undefined) data.state = input.state ?? null;
      if (input.postalCode !== undefined) data.postalCode = input.postalCode ?? null;
      if (input.country !== undefined) data.country = input.country ?? null;
      if (input.accessNotes !== undefined) data.accessNotes = input.accessNotes ?? null;
      if (input.gateCode !== undefined) data.gateCode = input.gateCode ?? null;
      if (input.contactName !== undefined) data.contactName = input.contactName ?? null;
      if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone ?? null;
      if (input.isPrimary !== undefined) data.isPrimary = input.isPrimary;
      if (input.archived !== undefined) data.archived = input.archived;

      const updated = await prisma.location.update({
        where: { id: existing.id },
        data,
        include,
      });

      if (updated.isPrimary) {
        await clearOtherPrimaries(auth.workspaceId, updated.customerId, updated.id);
      }

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "location.updated",
        entityType: "location",
        entityId: updated.id,
      });

      return toLocation(updated);
    },
  );

  app.post(
    "/locations/:id/restore",
    {
      preHandler: authenticate,
      schema: { tags: ["locations"], summary: "Restore a location", security: [{ bearerAuth: [] }] },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadLocationRow(auth.workspaceId, id);
      const restored = await prisma.location.update({
        where: { id: existing.id },
        data: { archived: false },
        include,
      });
      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "location.restored",
        entityType: "location",
        entityId: restored.id,
      });
      return toLocation(restored);
    },
  );

  app.delete(
    "/locations/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["locations"],
        summary: "Archive a location (permanent delete for admins)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadLocationRow(auth.workspaceId, id);
      const { permanent } = parseOrThrow(deleteQuerySchema, request.query);

      if (permanent === "true") {
        await requireRole(request, "ADMIN");
        // Jobs, estimates and invoices all point at the location. Deleting the
        // rows would erase service history, so require them to be moved first.
        const [jobs, estimates, invoices] = await Promise.all([
          prisma.job.count({ where: { locationId: existing.id } }),
          prisma.estimate.count({ where: { locationId: existing.id } }),
          prisma.invoice.count({ where: { locationId: existing.id } }),
        ]);
        if (jobs + estimates + invoices > 0) {
          throw badRequest("Move or archive this location's jobs, estimates and invoices first");
        }
        await prisma.location.delete({ where: { id: existing.id } });
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "location.deleted",
          entityType: "location",
          entityId: existing.id,
          metadata: { label: existing.label },
        });
      } else {
        await prisma.location.update({ where: { id: existing.id }, data: { archived: true } });
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "location.archived",
          entityType: "location",
          entityId: existing.id,
        });
      }

      return reply.status(204).send();
    },
  );
}
