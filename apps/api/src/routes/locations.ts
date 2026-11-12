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
      jobs: {
        where: {
          status: {
            in: ["UNSCHEDULED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS"],
          },
        },
      },
    },
  },
} satisfies Prisma.LocationInclude;

type LocationRow = Prisma.LocationGetPayload<{ include: typeof include }>;

const listQuerySchema = paginationSchema.extend({
  customerId: z.string().trim().max(64).optional(),
  archive: z.enum(["active", "archived", "all"]).default("active"),
});

const idParamsSchema = z.object({ id: z.string().min(1).max(64) });
const deleteQuerySchema = z.object({
  permanent: z.enum(["true", "false"]).optional(),
});

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

async function loadLocationRow(
  workspaceId: string,
  id: string,
): Promise<LocationRow> {
  const row = await prisma.location.findFirst({
    where: { id, workspaceId },
    include,
  });
  if (!row) throw notFound("Location");
  return row;
}

async function clearOtherPrimaries(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  customerId: string,
  keepId: string | null,
) {
  await tx.location.updateMany({
    where: {
      workspaceId,
      customerId,
      isPrimary: true,
      ...(keepId ? { id: { not: keepId } } : {}),
    },
    data: { isPrimary: false },
  });
}

/**
 * Active locations must always keep exactly one primary. When the current
 * primary is archived or demoted, the next active location inherits the flag;
 * if there is no candidate the write is rejected instead of silently leaving
 * the customer without a primary.
 */
async function promoteReplacementPrimary(
  tx: Prisma.TransactionClient,
  existing: { id: string; workspaceId: string; customerId: string },
): Promise<void> {
  const replacement = await tx.location.findFirst({
    where: {
      workspaceId: existing.workspaceId,
      customerId: existing.customerId,
      archived: false,
      id: { not: existing.id },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!replacement) {
    throw badRequest(
      "Add another active location before this one stops being the primary",
    );
  }
  await clearOtherPrimaries(
    tx,
    existing.workspaceId,
    existing.customerId,
    replacement.id,
  );
  await tx.location.update({
    where: { id: replacement.id },
    data: { isPrimary: true },
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
        ...(query.archive === "all"
          ? {}
          : { archived: query.archive === "archived" }),
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

      const orderBy: Prisma.LocationOrderByWithRelationInput[] =
        query.sort === "label"
          ? [{ label: query.order }, { id: "asc" }]
          : [{ updatedAt: query.order }, { id: "asc" }];

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

      const archived = input.archived ?? false;
      const isPrimary = archived ? false : (input.isPrimary ?? false);

      const created = await prisma.$transaction(async (tx) => {
        // The partial unique index allows one primary per customer, so existing
        // primaries must be cleared before the new row is inserted.
        if (isPrimary) {
          await clearOtherPrimaries(
            tx,
            auth.workspaceId,
            input.customerId,
            null,
          );
        }
        const row = await tx.location.create({
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
            latitude: input.latitude ?? null,
            longitude: input.longitude ?? null,
            isPrimary,
            archived,
          },
          include,
        });
        return row;
      });

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

      const archived = input.archived ?? existing.archived;
      const isPrimary = archived
        ? false
        : (input.isPrimary ?? existing.isPrimary);
      const losingPrimary = existing.isPrimary && !isPrimary;

      const data: Prisma.LocationUncheckedUpdateInput = {};
      if (input.label !== undefined) data.label = input.label;
      if (input.line1 !== undefined) data.line1 = input.line1;
      if (input.line2 !== undefined) data.line2 = input.line2 ?? null;
      if (input.city !== undefined) data.city = input.city;
      if (input.state !== undefined) data.state = input.state ?? null;
      if (input.postalCode !== undefined)
        data.postalCode = input.postalCode ?? null;
      if (input.country !== undefined) data.country = input.country ?? null;
      if (input.accessNotes !== undefined)
        data.accessNotes = input.accessNotes ?? null;
      if (input.gateCode !== undefined) data.gateCode = input.gateCode ?? null;
      if (input.contactName !== undefined)
        data.contactName = input.contactName ?? null;
      if (input.contactPhone !== undefined)
        data.contactPhone = input.contactPhone ?? null;
      if (input.latitude !== undefined) data.latitude = input.latitude ?? null;
      if (input.longitude !== undefined)
        data.longitude = input.longitude ?? null;
      if (input.isPrimary !== undefined || archived !== existing.archived) {
        data.isPrimary = isPrimary;
      }
      if (input.archived !== undefined) data.archived = archived;

      const updated = await prisma.$transaction(async (tx) => {
        if (losingPrimary) {
          await promoteReplacementPrimary(tx, existing);
        }
        if (isPrimary) {
          await clearOtherPrimaries(
            tx,
            auth.workspaceId,
            existing.customerId,
            existing.id,
          );
        }
        return tx.location.update({
          where: { id: existing.id },
          data,
          include,
        });
      });

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
      schema: {
        tags: ["locations"],
        summary: "Restore a location",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadLocationRow(auth.workspaceId, id);
      const restored = await prisma.$transaction(async (tx) => {
        const activePrimary = await tx.location.findFirst({
          where: {
            workspaceId: auth.workspaceId,
            customerId: existing.customerId,
            archived: false,
            isPrimary: true,
            id: { not: existing.id },
          },
          select: { id: true },
        });
        // Restoring the only active location makes it the primary; restoring a
        // former primary demotes any duplicate primary that appeared meanwhile.
        if (existing.isPrimary || !activePrimary) {
          await clearOtherPrimaries(
            tx,
            auth.workspaceId,
            existing.customerId,
            existing.id,
          );
        }
        return tx.location.update({
          where: { id: existing.id },
          data: {
            archived: false,
            ...(activePrimary ? {} : { isPrimary: true }),
          },
          include,
        });
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
        await prisma.$transaction(async (tx) => {
          // Jobs, estimates and invoices all point at the location. Deleting the
          // rows would erase service history, so require them to be moved first.
          const [jobs, estimates, invoices] = await Promise.all([
            tx.job.count({ where: { locationId: existing.id } }),
            tx.estimate.count({ where: { locationId: existing.id } }),
            tx.invoice.count({ where: { locationId: existing.id } }),
          ]);
          if (jobs + estimates + invoices > 0) {
            throw badRequest(
              "Move or archive this location's jobs, estimates and invoices first",
            );
          }
          if (existing.isPrimary && !existing.archived) {
            const replacement = await tx.location.findFirst({
              where: {
                workspaceId: auth.workspaceId,
                customerId: existing.customerId,
                archived: false,
                id: { not: existing.id },
              },
              orderBy: [
                { isPrimary: "desc" },
                { createdAt: "asc" },
                { id: "asc" },
              ],
              select: { id: true },
            });
            if (replacement) {
              await clearOtherPrimaries(
                tx,
                auth.workspaceId,
                existing.customerId,
                replacement.id,
              );
              await tx.location.update({
                where: { id: replacement.id },
                data: { isPrimary: true },
              });
            }
          }
          await tx.location.delete({ where: { id: existing.id } });
        });
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "location.deleted",
          entityType: "location",
          entityId: existing.id,
          metadata: { label: existing.label },
        });
      } else {
        await prisma.$transaction(async (tx) => {
          // Archiving never moves jobs; it only protects the primary invariant.
          if (existing.isPrimary && !existing.archived) {
            await promoteReplacementPrimary(tx, existing);
          }
          await tx.location.update({
            where: { id: existing.id },
            data: { archived: true, isPrimary: false },
          });
        });
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
