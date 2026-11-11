import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  JOB_STATUSES,
  jobDuplicateSchema,
  jobInputSchema,
  jobPatchSchema,
  jobStatusSchema,
  paginationSchema,
  type Job,
  type JobPriority,
  type JobStatus,
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
  allocateNumber,
  assertRecurrence,
  contactSummarySelect,
  customerSelect,
  locationSummarySelect,
  loadAssignee,
  priceLineItems,
  taxRateToBps,
  bpsToTaxRate,
  toContactSummary,
  toCustomerSummary,
  toLineItem,
  toLocationSummary,
  totalsFor,
  userSelect,
  validateAssociation,
  validateServiceIds,
} from "../lib/service-ops.js";

export const jobInclude = {
  customer: { select: customerSelect },
  location: { select: locationSummarySelect },
  contact: { select: contactSummarySelect },
  assignee: { select: userSelect },
  lineItems: { orderBy: { position: "asc" } },
} satisfies Prisma.JobInclude;

type JobRow = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status as JobStatus,
    priority: row.priority as JobPriority,
    source: row.source,
    customer: toCustomerSummary(row.customer),
    location: toLocationSummary(row.location),
    contact: row.contact ? toContactSummary(row.contact) : null,
    assignee: row.assignee,
    scheduledStart: iso(row.scheduledStart),
    scheduledEnd: iso(row.scheduledEnd),
    arrivedAt: iso(row.arrivedAt),
    completedAt: iso(row.completedAt),
    durationMinutes: row.durationMinutes,
    lineItems: row.lineItems.map(toLineItem),
    subtotal: row.subtotal,
    taxRate: bpsToTaxRate(row.taxRate),
    tax: row.tax,
    total: row.total,
    deposit: row.deposit,
    notes: row.notes,
    recurrence: assertRecurrence(row.recurrence),
    recurrenceUntil: iso(row.recurrenceUntil),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const listQuerySchema = paginationSchema.extend({
  status: z.enum(JOB_STATUSES).optional(),
  scope: z.enum(["all", "open", "today", "week", "unscheduled", "upcoming"]).default("all"),
  customerId: z.string().trim().max(64).optional(),
  locationId: z.string().trim().max(64).optional(),
  assigneeId: z.string().trim().max(64).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1).max(64) });
const deleteQuerySchema = z.object({ permanent: z.enum(["true", "false"]).optional() });

const OPEN_STATUSES = ["UNSCHEDULED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS"];

function parseBoundary(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest("Invalid date filter");
  return date;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export async function loadJobRow(workspaceId: string, id: string): Promise<JobRow> {
  const row = await prisma.job.findFirst({ where: { id, workspaceId }, include: jobInclude });
  if (!row) throw notFound("Job");
  return row;
}

async function assertAssignable(workspaceId: string, assigneeId: string | null | undefined) {
  if (assigneeId) await loadAssignee(workspaceId, assigneeId);
}

function scheduleDefaults(input: {
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  durationMinutes: number;
}) {
  const start = input.scheduledStart ?? null;
  // With no start there is no meaningful window, so never leave an orphan end.
  const end = start
    ? (input.scheduledEnd ?? new Date(start.getTime() + input.durationMinutes * 60_000))
    : null;
  if (start && end && end.getTime() < start.getTime()) {
    throw badRequest("The job cannot end before it starts");
  }
  return { start, end };
}

function statusTimestamps(status: JobStatus, existing?: { arrivedAt: Date | null; completedAt: Date | null }) {
  const now = new Date();
  const arrivedAt =
    status === "IN_PROGRESS" || status === "COMPLETED"
      ? (existing?.arrivedAt ?? now)
      : status === "UNSCHEDULED" || status === "SCHEDULED"
        ? null
        : (existing?.arrivedAt ?? null);
  const completedAt =
    status === "COMPLETED" ? (existing?.completedAt ?? now) : null;
  return { arrivedAt, completedAt };
}

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/jobs",
    {
      preHandler: authenticate,
      schema: {
        tags: ["jobs"],
        summary: "List jobs and work orders",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(listQuerySchema, request.query);
      const now = new Date();
      const todayStart = startOfUtcDay(now);

      const where: Prisma.JobWhereInput = {
        workspaceId: auth.workspaceId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      };

      if (query.scope === "open") where.status = { in: OPEN_STATUSES };
      if (query.scope === "unscheduled") where.status = "UNSCHEDULED";
      if (query.scope === "today") {
        where.scheduledStart = { gte: todayStart, lt: addDays(todayStart, 1) };
      }
      if (query.scope === "week") {
        where.scheduledStart = { gte: todayStart, lt: addDays(todayStart, 7) };
      }
      if (query.scope === "upcoming") {
        where.scheduledStart = { gte: now };
      }

      const from = parseBoundary(query.from);
      const to = parseBoundary(query.to);
      if (from || to) {
        where.scheduledStart = {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: addDays(to, 1) } : {}),
        };
      }

      if (query.q) {
        where.OR = [
          { number: { contains: likeTerm(query.q) } },
          { title: { contains: likeTerm(query.q) } },
          { customer: { name: { contains: likeTerm(query.q) } } },
          { location: { line1: { contains: likeTerm(query.q) } } },
        ];
      }

      const orderBy: Prisma.JobOrderByWithRelationInput[] =
        query.scope === "today" || query.scope === "week" || query.scope === "upcoming"
          ? [{ scheduledStart: "asc" }, { createdAt: "desc" }]
          : query.sort === "scheduledStart"
            ? [{ scheduledStart: query.order }, { createdAt: "desc" }]
            : query.sort === "total"
              ? [{ total: query.order }]
              : [{ updatedAt: query.order }];

      const [total, rows] = await Promise.all([
        prisma.job.count({ where }),
        prisma.job.findMany({
          where,
          include: jobInclude,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      return {
        data: rows.map(toJob),
        meta: pageMeta(total, query.page, query.pageSize),
      };
    },
  );

  app.post(
    "/jobs",
    {
      preHandler: authenticate,
      schema: {
        tags: ["jobs"],
        summary: "Create a job",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const input = parseOrThrow(jobInputSchema, request.body);
      await validateAssociation(auth.workspaceId, input.customerId, input.locationId, input.contactId);
      await validateServiceIds(auth.workspaceId, input.lineItems);
      await assertAssignable(auth.workspaceId, input.assigneeId);

      const { start, end } = scheduleDefaults(input);
      const { lines, subtotal } = priceLineItems(input.lineItems);
      const totals = totalsFor(subtotal, taxRateToBps(input.taxRate));
      const stamps = statusTimestamps(input.status);
      if (input.deposit > totals.total) {
        throw badRequest("The deposit cannot exceed the job total");
      }

      const number = await allocateNumber("JOB", async (candidate) =>
        Boolean(await prisma.job.findUnique({ where: { workspaceId_number: { workspaceId: auth.workspaceId, number: candidate } } })),
      );

      const created = await prisma.job.create({
        data: {
          workspaceId: auth.workspaceId,
          number,
          title: input.title,
          status: input.status,
          priority: input.priority,
          source: input.source ?? null,
          customerId: input.customerId,
          locationId: input.locationId,
          contactId: input.contactId ?? null,
          assigneeId: input.assigneeId ?? null,
          scheduledStart: start,
          scheduledEnd: end,
          arrivedAt: stamps.arrivedAt,
          completedAt: stamps.completedAt,
          durationMinutes: input.durationMinutes,
          taxRate: taxRateToBps(input.taxRate),
          subtotal: totals.subtotal,
          tax: totals.tax,
          total: totals.total,
          deposit: input.deposit,
          notes: input.notes ?? null,
          recurrence: input.recurrence ?? null,
          recurrenceUntil: input.recurrenceUntil ?? null,
          lineItems: { create: lines },
        },
        include: jobInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "job.created",
        entityType: "job",
        entityId: created.id,
        metadata: { number: created.number, total: created.total },
      });

      return reply.status(201).send(toJob(created));
    },
  );

  app.get(
    "/jobs/:id",
    {
      preHandler: authenticate,
      schema: { tags: ["jobs"], summary: "Fetch a job", security: [{ bearerAuth: [] }] },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      return toJob(await loadJobRow(auth.workspaceId, id));
    },
  );

  app.patch(
    "/jobs/:id",
    {
      preHandler: authenticate,
      schema: { tags: ["jobs"], summary: "Update a job", security: [{ bearerAuth: [] }] },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadJobRow(auth.workspaceId, id);
      const input = parseOrThrow(jobPatchSchema, request.body);

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
      if (input.assigneeId !== undefined) {
        await assertAssignable(auth.workspaceId, input.assigneeId);
      }
      if (input.lineItems !== undefined) {
        await validateServiceIds(auth.workspaceId, input.lineItems);
      }

      const data: Prisma.JobUncheckedUpdateInput = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.status !== undefined) {
        data.status = input.status;
        Object.assign(data, statusTimestamps(input.status, existing));
      }
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.source !== undefined) data.source = input.source ?? null;
      if (input.customerId !== undefined) data.customerId = input.customerId;
      if (input.locationId !== undefined) data.locationId = input.locationId;
      if (input.contactId !== undefined) data.contactId = input.contactId ?? null;
      if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId ?? null;
      if (input.notes !== undefined) data.notes = input.notes ?? null;
      if (input.recurrence !== undefined) data.recurrence = input.recurrence ?? null;
      if (input.recurrenceUntil !== undefined) data.recurrenceUntil = input.recurrenceUntil ?? null;
      if (input.durationMinutes !== undefined) data.durationMinutes = input.durationMinutes;
      if (input.deposit !== undefined) data.deposit = input.deposit;

      if (input.scheduledStart !== undefined || input.scheduledEnd !== undefined || input.durationMinutes !== undefined) {
        const { start, end } = scheduleDefaults({
          scheduledStart: input.scheduledStart !== undefined ? input.scheduledStart : existing.scheduledStart,
          scheduledEnd: input.scheduledEnd !== undefined ? input.scheduledEnd : existing.scheduledEnd,
          durationMinutes: input.durationMinutes ?? existing.durationMinutes,
        });
        data.scheduledStart = start;
        data.scheduledEnd = end;
      }

      const taxRate = input.taxRate !== undefined ? taxRateToBps(input.taxRate) : existing.taxRate;
      if (input.taxRate !== undefined) data.taxRate = taxRate;

      const updated = await prisma.$transaction(async (tx) => {
        let subtotal = existing.subtotal;
        if (input.lineItems !== undefined) {
          const priced = priceLineItems(input.lineItems);
          subtotal = priced.subtotal;
          await tx.jobLineItem.deleteMany({ where: { jobId: existing.id } });
          await tx.jobLineItem.createMany({
            data: priced.lines.map((line) => ({ ...line, jobId: existing.id })),
          });
        }
        const totals = totalsFor(subtotal, taxRate);
        if (input.lineItems !== undefined || input.taxRate !== undefined) {
          data.subtotal = totals.subtotal;
          data.tax = totals.tax;
          data.total = totals.total;
        }

        const deposit = input.deposit !== undefined ? input.deposit : existing.deposit;
        if (deposit > (typeof data.total === "number" ? data.total : existing.total)) {
          throw badRequest("The deposit cannot exceed the job total");
        }

        return tx.job.update({
          where: { id: existing.id },
          data,
          include: jobInclude,
        });
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "job.updated",
        entityType: "job",
        entityId: updated.id,
        metadata: { number: updated.number },
      });

      return toJob(updated);
    },
  );

  app.patch(
    "/jobs/:id/status",
    {
      preHandler: authenticate,
      schema: {
        tags: ["jobs"],
        summary: "Move a job through its lifecycle",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadJobRow(auth.workspaceId, id);
      const input = parseOrThrow(jobStatusSchema, request.body);
      const stamps = statusTimestamps(input.status, existing);

      const updated = await prisma.job.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          ...stamps,
          ...(input.status === "CANCELED" && input.cancelReason
            ? { notes: [existing.notes, `Canceled: ${input.cancelReason}`].filter(Boolean).join("\n") }
            : {}),
        },
        include: jobInclude,
      });

      if (input.status === "COMPLETED" && existing.status !== "COMPLETED") {
        await prisma.activity.create({
          data: {
            workspaceId: auth.workspaceId,
            type: "NOTE",
            title: `Completed ${updated.number}: ${updated.title}`,
            body: updated.notes,
            completedAt: new Date(),
            companyId: updated.customerId,
            contactId: updated.contactId,
            ownerId: updated.assigneeId ?? auth.userId,
          },
        });
      }

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "job.status_changed",
        entityType: "job",
        entityId: updated.id,
        metadata: { number: updated.number, from: existing.status, to: input.status },
      });

      return toJob(updated);
    },
  );

  app.post(
    "/jobs/:id/duplicate",
    {
      preHandler: authenticate,
      schema: { tags: ["jobs"], summary: "Copy a job", security: [{ bearerAuth: [] }] },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadJobRow(auth.workspaceId, id);
      const input = parseOrThrow(jobDuplicateSchema, request.body ?? {});

      const start = input.scheduledStart ?? null;
      const end = start
        ? new Date(start.getTime() + existing.durationMinutes * 60_000)
        : null;
      const number = await allocateNumber("JOB", async (candidate) =>
        Boolean(await prisma.job.findUnique({ where: { workspaceId_number: { workspaceId: auth.workspaceId, number: candidate } } })),
      );

      const created = await prisma.job.create({
        data: {
          workspaceId: auth.workspaceId,
          number,
          title: existing.title,
          status: start ? "SCHEDULED" : "UNSCHEDULED",
          priority: existing.priority,
          source: existing.source,
          customerId: existing.customerId,
          locationId: existing.locationId,
          contactId: existing.contactId,
          assigneeId: existing.assigneeId,
          scheduledStart: start,
          scheduledEnd: end,
          durationMinutes: existing.durationMinutes,
          taxRate: existing.taxRate,
          subtotal: existing.subtotal,
          tax: existing.tax,
          total: existing.total,
          deposit: 0,
          notes: existing.notes,
          recurrence: existing.recurrence,
          recurrenceUntil: existing.recurrenceUntil,
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

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "job.duplicated",
        entityType: "job",
        entityId: created.id,
        metadata: { number: created.number, source: existing.number },
      });

      return reply.status(201).send(toJob(created));
    },
  );

  app.delete(
    "/jobs/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["jobs"],
        summary: "Delete a job (admins)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadJobRow(auth.workspaceId, id);
      parseOrThrow(deleteQuerySchema, request.query);
      await requireRole(request, "ADMIN");
      await prisma.job.delete({ where: { id: existing.id } });
      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "job.deleted",
        entityType: "job",
        entityId: existing.id,
        metadata: { number: existing.number },
      });
      return reply.status(204).send();
    },
  );
}

export type { JobRow };
