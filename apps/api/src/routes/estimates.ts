import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ESTIMATE_STATUSES,
  estimateConvertSchema,
  estimateInputSchema,
  estimatePatchSchema,
  estimateStatusSchema,
  paginationSchema,
  type Estimate,
  type EstimateStatus,
} from "@meridian/contracts";
import type { Prisma } from "@prisma/client";
import { authenticate, getAuth, requireRole } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/db.js";
import {
  badRequest,
  conflict,
  iso,
  likeTerm,
  notFound,
  pageMeta,
  parseOrThrow,
} from "../lib/http.js";
import {
  allocateNumber,
  bpsToTaxRate,
  contactSummarySelect,
  customerSelect,
  locationSummarySelect,
  loadAssignee,
  priceLineItems,
  taxRateToBps,
  toContactSummary,
  toCustomerSummary,
  toLineItem,
  toLocationSummary,
  totalsFor,
  validateAssociation,
  validateServiceIds,
} from "../lib/service-ops.js";
import { jobInclude, toJob } from "./jobs.js";

export const estimateInclude = {
  customer: { select: customerSelect },
  location: { select: locationSummarySelect },
  contact: { select: contactSummarySelect },
  job: { select: { id: true, number: true } },
  lineItems: { orderBy: { position: "asc" } },
} satisfies Prisma.EstimateInclude;

type EstimateRow = Prisma.EstimateGetPayload<{ include: typeof estimateInclude }>;

export function toEstimate(row: EstimateRow): Estimate {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status as EstimateStatus,
    customer: toCustomerSummary(row.customer),
    location: toLocationSummary(row.location),
    contact: row.contact ? toContactSummary(row.contact) : null,
    lineItems: row.lineItems.map(toLineItem),
    subtotal: row.subtotal,
    taxRate: bpsToTaxRate(row.taxRate),
    tax: row.tax,
    total: row.total,
    issuedAt: iso(row.issuedAt),
    expiresAt: iso(row.expiresAt),
    notes: row.notes,
    jobId: row.job?.id ?? null,
    jobNumber: row.job?.number ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const listQuerySchema = paginationSchema.extend({
  status: z.enum(ESTIMATE_STATUSES).optional(),
  customerId: z.string().trim().max(64).optional(),
  open: z.enum(["true", "false"]).optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1).max(64) });

async function loadEstimateRow(workspaceId: string, id: string): Promise<EstimateRow> {
  const row = await prisma.estimate.findFirst({
    where: { id, workspaceId },
    include: estimateInclude,
  });
  if (!row) throw notFound("Estimate");
  return row;
}

async function nextEstimateNumber(workspaceId: string): Promise<string> {
  return allocateNumber("EST", async (candidate) =>
    Boolean(
      await prisma.estimate.findUnique({
        where: { workspaceId_number: { workspaceId, number: candidate } },
      }),
    ),
  );
}

export async function estimateRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/estimates",
    {
      preHandler: authenticate,
      schema: {
        tags: ["estimates"],
        summary: "List estimates and quotes",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(listQuerySchema, request.query);
      const where: Prisma.EstimateWhereInput = {
        workspaceId: auth.workspaceId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.open === "true" ? { status: { in: ["DRAFT", "SENT"] } } : {}),
        ...(query.q
          ? {
              OR: [
                { number: { contains: likeTerm(query.q) } },
                { title: { contains: likeTerm(query.q) } },
                { customer: { name: { contains: likeTerm(query.q) } } },
              ],
            }
          : {}),
      };

      const orderBy: Prisma.EstimateOrderByWithRelationInput =
        query.sort === "total" ? { total: query.order } : { updatedAt: query.order };

      const [total, rows] = await Promise.all([
        prisma.estimate.count({ where }),
        prisma.estimate.findMany({
          where,
          include: estimateInclude,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      return {
        data: rows.map(toEstimate),
        meta: pageMeta(total, query.page, query.pageSize),
      };
    },
  );

  app.post(
    "/estimates",
    {
      preHandler: authenticate,
      schema: {
        tags: ["estimates"],
        summary: "Create an estimate",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const input = parseOrThrow(estimateInputSchema, request.body);
      await validateAssociation(auth.workspaceId, input.customerId, input.locationId, input.contactId);
      await validateServiceIds(auth.workspaceId, input.lineItems);

      const { lines, subtotal } = priceLineItems(input.lineItems);
      const totals = totalsFor(subtotal, taxRateToBps(input.taxRate));
      const number = await nextEstimateNumber(auth.workspaceId);

      const created = await prisma.estimate.create({
        data: {
          workspaceId: auth.workspaceId,
          number,
          title: input.title,
          status: input.status,
          customerId: input.customerId,
          locationId: input.locationId,
          contactId: input.contactId ?? null,
          ownerId: auth.userId,
          issuedAt: input.issuedAt ?? (input.status === "DRAFT" ? null : new Date()),
          expiresAt: input.expiresAt ?? null,
          taxRate: taxRateToBps(input.taxRate),
          subtotal: totals.subtotal,
          tax: totals.tax,
          total: totals.total,
          notes: input.notes ?? null,
          lineItems: { create: lines },
        },
        include: estimateInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "estimate.created",
        entityType: "estimate",
        entityId: created.id,
        metadata: { number: created.number, total: created.total },
      });

      return reply.status(201).send(toEstimate(created));
    },
  );

  app.get(
    "/estimates/:id",
    {
      preHandler: authenticate,
      schema: { tags: ["estimates"], summary: "Fetch an estimate", security: [{ bearerAuth: [] }] },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      return toEstimate(await loadEstimateRow(auth.workspaceId, id));
    },
  );

  app.patch(
    "/estimates/:id",
    {
      preHandler: authenticate,
      schema: { tags: ["estimates"], summary: "Update an estimate", security: [{ bearerAuth: [] }] },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadEstimateRow(auth.workspaceId, id);
      if (existing.jobId) throw conflict("This estimate has already been converted to a job");
      const input = parseOrThrow(estimatePatchSchema, request.body);

      const customerId = input.customerId ?? existing.customerId;
      const locationId = input.locationId ?? existing.locationId;
      if (input.customerId !== undefined || input.locationId !== undefined || input.contactId !== undefined) {
        await validateAssociation(
          auth.workspaceId,
          customerId,
          locationId,
          input.contactId !== undefined ? input.contactId : existing.contactId,
        );
      }
      if (input.lineItems !== undefined) {
        await validateServiceIds(auth.workspaceId, input.lineItems);
      }

      const data: Prisma.EstimateUncheckedUpdateInput = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.status !== undefined) {
        data.status = input.status;
        if (input.status !== "DRAFT" && !existing.issuedAt) data.issuedAt = new Date();
      }
      if (input.customerId !== undefined) data.customerId = input.customerId;
      if (input.locationId !== undefined) data.locationId = input.locationId;
      if (input.contactId !== undefined) data.contactId = input.contactId ?? null;
      if (input.issuedAt !== undefined) data.issuedAt = input.issuedAt ?? null;
      if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt ?? null;
      if (input.notes !== undefined) data.notes = input.notes ?? null;

      const taxRate = input.taxRate !== undefined ? taxRateToBps(input.taxRate) : existing.taxRate;
      if (input.taxRate !== undefined) data.taxRate = taxRate;

      const updated = await prisma.$transaction(async (tx) => {
        let subtotal = existing.subtotal;
        if (input.lineItems !== undefined) {
          const priced = priceLineItems(input.lineItems);
          subtotal = priced.subtotal;
          await tx.estimateLineItem.deleteMany({ where: { estimateId: existing.id } });
          await tx.estimateLineItem.createMany({
            data: priced.lines.map((line) => ({ ...line, estimateId: existing.id })),
          });
        }
        if (input.lineItems !== undefined || input.taxRate !== undefined) {
          const totals = totalsFor(subtotal, taxRate);
          data.subtotal = totals.subtotal;
          data.tax = totals.tax;
          data.total = totals.total;
        }
        return tx.estimate.update({ where: { id: existing.id }, data, include: estimateInclude });
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "estimate.updated",
        entityType: "estimate",
        entityId: updated.id,
      });

      return toEstimate(updated);
    },
  );

  app.patch(
    "/estimates/:id/status",
    {
      preHandler: authenticate,
      schema: {
        tags: ["estimates"],
        summary: "Send, approve or decline an estimate",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadEstimateRow(auth.workspaceId, id);
      const input = parseOrThrow(estimateStatusSchema, request.body);

      const updated = await prisma.estimate.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          ...(input.status !== "DRAFT" && !existing.issuedAt ? { issuedAt: new Date() } : {}),
        },
        include: estimateInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "estimate.status_changed",
        entityType: "estimate",
        entityId: updated.id,
        metadata: { from: existing.status, to: input.status },
      });

      return toEstimate(updated);
    },
  );

  app.post(
    "/estimates/:id/convert",
    {
      preHandler: authenticate,
      schema: {
        tags: ["estimates"],
        summary: "Convert an approved estimate into a job",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadEstimateRow(auth.workspaceId, id);
      const input = parseOrThrow(estimateConvertSchema, request.body ?? {});

      if (existing.jobId) throw conflict(`This estimate is already on ${existing.job?.number ?? "a job"}`);
      if (existing.status !== "SENT" && existing.status !== "APPROVED") {
        throw badRequest("Only sent or approved estimates can be converted to jobs");
      }
      if (input.assigneeId) await loadAssignee(auth.workspaceId, input.assigneeId);

      const start = input.scheduledStart ?? null;
      const number = await allocateNumber("JOB", async (candidate) =>
        Boolean(
          await prisma.job.findUnique({
            where: { workspaceId_number: { workspaceId: auth.workspaceId, number: candidate } },
          }),
        ),
      );

      const job = await prisma.$transaction(async (tx) => {
        const created = await tx.job.create({
          data: {
            workspaceId: auth.workspaceId,
            number,
            title: existing.title,
            status: start ? "SCHEDULED" : "UNSCHEDULED",
            priority: "NORMAL",
            source: "Estimate",
            customerId: existing.customerId,
            locationId: existing.locationId,
            contactId: existing.contactId,
            assigneeId: input.assigneeId ?? null,
            scheduledStart: start,
            scheduledEnd: start
              ? new Date(start.getTime() + 60 * 60_000)
              : null,
            durationMinutes: 60,
            taxRate: existing.taxRate,
            subtotal: existing.subtotal,
            tax: existing.tax,
            total: existing.total,
            deposit: 0,
            notes: existing.notes,
            lineItems: {
              create: existing.lineItems.map((line) => ({
                serviceId: line.serviceId,
                name: line.name,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                total: line.total,
                position: line.position,
              })),
            },
          },
          include: jobInclude,
        });
        await tx.estimate.update({
          where: { id: existing.id },
          data: { jobId: created.id, status: "APPROVED" },
        });
        return created;
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "estimate.converted",
        entityType: "estimate",
        entityId: existing.id,
        metadata: { jobId: job.id, jobNumber: job.number },
      });

      return reply.status(201).send(toJob(job));
    },
  );

  app.delete(
    "/estimates/:id",
    {
      preHandler: authenticate,
      schema: { tags: ["estimates"], summary: "Delete an estimate", security: [{ bearerAuth: [] }] },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadEstimateRow(auth.workspaceId, id);
      await requireRole(request, "ADMIN");
      await prisma.estimate.delete({ where: { id: existing.id } });
      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "estimate.deleted",
        entityType: "estimate",
        entityId: existing.id,
        metadata: { number: existing.number },
      });
      return reply.status(204).send();
    },
  );
}
