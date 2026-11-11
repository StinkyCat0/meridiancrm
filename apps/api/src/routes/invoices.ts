import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  INVOICE_STATUSES,
  invoiceInputSchema,
  invoicePatchSchema,
  invoicePaymentSchema,
  paginationSchema,
  type Invoice,
  type InvoiceStatus,
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
  customerSelect,
  invoiceState,
  loadCustomer,
  loadLocation,
  locationSummarySelect,
  toCustomerSummary,
  toLocationSummary,
} from "../lib/service-ops.js";

const include = {
  customer: { select: customerSelect },
  location: { select: locationSummarySelect },
  job: { select: { id: true, number: true } },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof include }>;

function toInvoice(row: InvoiceRow, now = new Date()): Invoice {
  const status = row.status as InvoiceStatus;
  const state = invoiceState(status, row.amount, row.amountPaid, row.dueAt, now);
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status,
    overdue: state.overdue,
    customer: toCustomerSummary(row.customer),
    location: row.location ? toLocationSummary(row.location) : null,
    jobId: row.job?.id ?? null,
    jobNumber: row.job?.number ?? null,
    amount: row.amount,
    amountPaid: row.amountPaid,
    balance: state.balance,
    issuedAt: iso(row.issuedAt),
    dueAt: iso(row.dueAt),
    paidAt: iso(row.paidAt),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const listQuerySchema = paginationSchema.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
  customerId: z.string().trim().max(64).optional(),
  jobId: z.string().trim().max(64).optional(),
  overdue: z.enum(["true", "false"]).optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1).max(64) });

async function loadInvoiceRow(workspaceId: string, id: string): Promise<InvoiceRow> {
  const row = await prisma.invoice.findFirst({ where: { id, workspaceId }, include });
  if (!row) throw notFound("Invoice");
  return row;
}

async function nextInvoiceNumber(workspaceId: string): Promise<string> {
  return allocateNumber("INV", async (candidate) =>
    Boolean(
      await prisma.invoice.findUnique({
        where: { workspaceId_number: { workspaceId, number: candidate } },
      }),
    ),
  );
}

export async function invoiceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/invoices",
    {
      preHandler: authenticate,
      schema: {
        tags: ["invoices"],
        summary: "List invoices",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(listQuerySchema, request.query);
      const now = new Date();
      const where: Prisma.InvoiceWhereInput = {
        workspaceId: auth.workspaceId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.jobId ? { jobId: query.jobId } : {}),
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

      if (query.overdue === "true") {
        where.status = { notIn: ["PAID", "VOID", "DRAFT"] };
        where.dueAt = { lt: now };
      }

      const orderBy: Prisma.InvoiceOrderByWithRelationInput[] =
        query.sort === "amount"
          ? [{ amount: query.order }]
          : query.sort === "dueAt"
            ? [{ dueAt: query.order }]
            : [{ createdAt: query.order }];

      const [total, rows] = await Promise.all([
        prisma.invoice.count({ where }),
        prisma.invoice.findMany({
          where,
          include,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      return {
        data: rows.map((row) => toInvoice(row, now)),
        meta: pageMeta(total, query.page, query.pageSize),
      };
    },
  );

  app.post(
    "/invoices",
    {
      preHandler: authenticate,
      schema: {
        tags: ["invoices"],
        summary: "Create an invoice, optionally from a job",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const input = parseOrThrow(invoiceInputSchema, request.body);

      let customerId = input.customerId ?? null;
      let locationId = input.locationId ?? null;
      let amount = input.amount ?? 0;

      if (input.jobId) {
        const job = await prisma.job.findFirst({
          where: { id: input.jobId, workspaceId: auth.workspaceId },
          select: {
            id: true,
            customerId: true,
            locationId: true,
            total: true,
            title: true,
          },
        });
        if (!job) throw notFound("Job");
        customerId = job.customerId;
        locationId = job.locationId;
        if (input.amount === undefined) amount = job.total;
      }

      if (!customerId) throw badRequest("An invoice needs a job or a customer");
      await loadCustomer(auth.workspaceId, customerId);
      if (locationId) await loadLocation(auth.workspaceId, locationId, customerId);

      const number = await nextInvoiceNumber(auth.workspaceId);
      const issuedAt = input.issuedAt ?? (input.status === "DRAFT" ? null : new Date());

      const created = await prisma.invoice.create({
        data: {
          workspaceId: auth.workspaceId,
          number,
          title: input.title,
          status: input.status,
          customerId,
          locationId,
          jobId: input.jobId ?? null,
          amount,
          amountPaid: input.status === "PAID" ? amount : 0,
          issuedAt,
          dueAt: input.dueAt ?? null,
          paidAt: input.status === "PAID" ? new Date() : null,
          notes: input.notes ?? null,
        },
        include,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "invoice.created",
        entityType: "invoice",
        entityId: created.id,
        metadata: { number: created.number, amount: created.amount },
      });

      return reply.status(201).send(toInvoice(created));
    },
  );

  app.get(
    "/invoices/:id",
    {
      preHandler: authenticate,
      schema: { tags: ["invoices"], summary: "Fetch an invoice", security: [{ bearerAuth: [] }] },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      return toInvoice(await loadInvoiceRow(auth.workspaceId, id));
    },
  );

  app.patch(
    "/invoices/:id",
    {
      preHandler: authenticate,
      schema: { tags: ["invoices"], summary: "Update an invoice", security: [{ bearerAuth: [] }] },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadInvoiceRow(auth.workspaceId, id);
      const input = parseOrThrow(invoicePatchSchema, request.body);

      const amount = input.amount ?? existing.amount;
      let amountPaid = input.amountPaid ?? existing.amountPaid;
      if (amountPaid > amount) throw badRequest("Payments cannot exceed the invoice amount");

      const data: Prisma.InvoiceUncheckedUpdateInput = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.amount !== undefined) data.amount = input.amount;
      if (input.amountPaid !== undefined) data.amountPaid = input.amountPaid;
      if (input.issuedAt !== undefined) data.issuedAt = input.issuedAt ?? null;
      if (input.dueAt !== undefined) data.dueAt = input.dueAt ?? null;
      if (input.notes !== undefined) data.notes = input.notes ?? null;

      const nextStatus = input.status ?? (existing.status as InvoiceStatus);
      if (nextStatus === "PAID") {
        amountPaid = amount;
        data.amountPaid = amount;
        data.paidAt = input.paidAt ?? existing.paidAt ?? new Date();
      } else {
        if (input.status !== undefined) data.status = input.status;
        if (input.paidAt !== undefined) data.paidAt = input.paidAt ?? null;
      }
      if (nextStatus !== "PAID" && existing.status === "PAID" && input.status !== undefined) {
        data.paidAt = null;
      }

      const updated = await prisma.invoice.update({
        where: { id: existing.id },
        data: { ...data, ...(input.status !== undefined ? { status: nextStatus } : {}) },
        include,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "invoice.updated",
        entityType: "invoice",
        entityId: updated.id,
      });

      return toInvoice(updated);
    },
  );

  app.patch(
    "/invoices/:id/payment",
    {
      preHandler: authenticate,
      schema: {
        tags: ["invoices"],
        summary: "Record a payment against an invoice",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadInvoiceRow(auth.workspaceId, id);
      const input = parseOrThrow(invoicePaymentSchema, request.body);

      if (existing.status === "VOID") throw badRequest("Void invoices cannot take payments");
      if (input.amountPaid > existing.amount) {
        throw badRequest("Payments cannot exceed the invoice amount");
      }

      const status: InvoiceStatus =
        input.amountPaid >= existing.amount ? "PAID" : input.amountPaid > 0 ? "PARTIAL" : "SENT";
      const updated = await prisma.invoice.update({
        where: { id: existing.id },
        data: {
          amountPaid: input.amountPaid,
          status,
          paidAt: status === "PAID" ? (existing.paidAt ?? new Date()) : null,
          issuedAt: existing.issuedAt ?? new Date(),
        },
        include,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "invoice.payment",
        entityType: "invoice",
        entityId: updated.id,
        metadata: { amountPaid: input.amountPaid, status },
      });

      return toInvoice(updated);
    },
  );

  app.delete(
    "/invoices/:id",
    {
      preHandler: authenticate,
      schema: { tags: ["invoices"], summary: "Delete an invoice", security: [{ bearerAuth: [] }] },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadInvoiceRow(auth.workspaceId, id);
      await requireRole(request, "ADMIN");
      await prisma.invoice.delete({ where: { id: existing.id } });
      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "invoice.deleted",
        entityType: "invoice",
        entityId: existing.id,
        metadata: { number: existing.number },
      });
      return reply.status(204).send();
    },
  );
}
