import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_TRANSITIONS,
  canTransitionInvoice,
  deriveInvoiceStatus,
  invoiceInputSchema,
  invoiceIsOverdue,
  invoicePatchSchema,
  invoicePaymentSchema,
  paginationSchema,
  paymentInputSchema,
  type Invoice,
  type InvoiceStatus,
  type Payment,
  type PaymentMethod,
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
  createWithDocumentNumber,
  customerSelect,
  loadCustomer,
  loadLocation,
  locationSummarySelect,
  userSelect,
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
  const balance = Math.max(0, row.amount - row.amountPaid);
  const overdue = invoiceIsOverdue(status, balance, row.dueAt, now);
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status,
    overdue,
    customer: toCustomerSummary(row.customer),
    location: row.location ? toLocationSummary(row.location) : null,
    jobId: row.job?.id ?? null,
    jobNumber: row.job?.number ?? null,
    amount: row.amount,
    amountPaid: row.amountPaid,
    balance,
    issuedAt: iso(row.issuedAt),
    dueAt: iso(row.dueAt),
    paidAt: iso(row.paidAt),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const paymentInclude = {
  invoice: { select: { number: true, customer: { select: customerSelect } } },
  recordedBy: { select: userSelect },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoice.number,
    customer: toCustomerSummary(row.invoice.customer),
    amount: row.amount,
    method: row.method as PaymentMethod,
    reference: row.reference,
    receivedAt: row.receivedAt.toISOString(),
    recordedBy: row.recordedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

const listQuerySchema = paginationSchema.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
  customerId: z.string().trim().max(64).optional(),
  jobId: z.string().trim().max(64).optional(),
  overdue: z.enum(["true", "false"]).optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1).max(64) });

const OVERDUE_STATUSES: readonly InvoiceStatus[] = ["SENT", "PARTIAL"];

async function loadInvoiceRow(
  workspaceId: string,
  id: string,
): Promise<InvoiceRow> {
  const row = await prisma.invoice.findFirst({
    where: { id, workspaceId },
    include,
  });
  if (!row) throw notFound("Invoice");
  return row;
}

/**
 * Every money change lands in the Payment ledger in the same transaction as the
 * invoice update. Positive deltas are receipts; negative deltas are corrections
 * and are always booked as ADJUSTMENT so reporting can separate them.
 */
async function recordPaymentDelta(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    invoiceId: string;
    delta: number;
    actorId: string;
    method?: PaymentMethod;
    reference?: string | null;
    receivedAt?: Date;
  },
): Promise<void> {
  if (input.delta === 0) return;
  await tx.payment.create({
    data: {
      workspaceId: input.workspaceId,
      invoiceId: input.invoiceId,
      amount: input.delta,
      method: input.delta > 0 ? (input.method ?? "CARD") : "ADJUSTMENT",
      reference: input.reference ?? null,
      receivedAt: input.receivedAt ?? new Date(),
      recordedById: input.actorId,
    },
  });
}

function assertInvoiceMutable(status: InvoiceStatus): void {
  if (status === "VOID") {
    throw conflict("Void invoices cannot be changed", {
      status,
      allowed: ["VOID"],
    });
  }
}

/**
 * An explicitly requested status must agree with the invoice's final money.
 * PAID needs a positive, fully settled total, PARTIAL needs a partial payment,
 * SENT/DRAFT require nothing paid yet, and VOID is only legal when no money has
 * been recorded.
 */
function assertStatusMatchesMoney(
  status: InvoiceStatus,
  amount: number,
  amountPaid: number,
  current: InvoiceStatus,
): void {
  const consistent =
    status === "PAID"
      ? amount > 0 && amountPaid >= amount
      : status === "PARTIAL"
        ? amountPaid > 0 && amountPaid < amount
        : status === "SENT"
          ? amountPaid === 0
          : status === "DRAFT"
            ? current === "DRAFT" && amountPaid === 0
            : amountPaid === 0;
  if (!consistent) {
    throw badRequest(
      `${status} does not match an amount of ${amount} with ${amountPaid} paid`,
      {
        status,
        amount,
        amountPaid,
        derived: deriveInvoiceStatus(amount, amountPaid, current),
      },
    );
  }
}

function paymentStatus(
  existing: InvoiceRow,
  amountPaid: number,
  current: InvoiceStatus,
): InvoiceStatus {
  const derived = deriveInvoiceStatus(existing.amount, amountPaid, current);
  if (current === "PAID" && derived !== "PAID") {
    throw conflict("A paid invoice cannot be reopened", {
      status: current,
      allowed: INVOICE_STATUS_TRANSITIONS[current],
    });
  }
  return derived;
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
        // An overdue filter narrows the requested status instead of replacing it,
        // so `status=PAID&overdue=true` correctly returns nothing.
        const status = query.status;
        if (status && !OVERDUE_STATUSES.includes(status)) {
          where.status = { in: [] };
        } else {
          where.status = status ?? { in: [...OVERDUE_STATUSES] };
        }
        where.dueAt = { lt: now };
        where.amount = { gt: 0 };
      }

      const orderBy: Prisma.InvoiceOrderByWithRelationInput[] =
        query.sort === "amount"
          ? [{ amount: query.order }, { id: "asc" }]
          : query.sort === "dueAt"
            ? [{ dueAt: query.order }, { id: "asc" }]
            : [{ createdAt: query.order }, { id: "asc" }];

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
      const resolvedCustomerId = customerId;
      await loadCustomer(auth.workspaceId, resolvedCustomerId);
      if (!locationId) {
        // Customer-only invoices still point at the customer's primary site;
        // the form only sends customerId and the API owns the fallback.
        const primary = await prisma.location.findFirst({
          where: {
            workspaceId: auth.workspaceId,
            customerId: resolvedCustomerId,
            archived: false,
            isPrimary: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        locationId = primary?.id ?? null;
      }
      if (locationId)
        await loadLocation(auth.workspaceId, locationId, resolvedCustomerId);

      if (input.status === "PARTIAL") {
        // Creation has no amountPaid field, so a partial invoice cannot exist.
        throw badRequest(
          "An invoice cannot be created as partially paid; record a payment instead",
        );
      }
      if (input.status === "PAID" && amount <= 0) {
        throw badRequest("A zero-total invoice cannot be marked paid");
      }
      const issuedAt =
        input.status === "DRAFT" ? null : (input.issuedAt ?? new Date());
      const paidAt = input.status === "PAID" ? new Date() : null;
      const amountPaid = input.status === "PAID" ? amount : 0;

      const created = await createWithDocumentNumber(
        auth.workspaceId,
        "INV",
        async (tx, number) => {
          const invoice = await tx.invoice.create({
            data: {
              workspaceId: auth.workspaceId,
              number,
              title: input.title,
              status: input.status,
              customerId: resolvedCustomerId,
              locationId,
              jobId: input.jobId ?? null,
              amount,
              amountPaid,
              issuedAt,
              dueAt: input.dueAt ?? null,
              paidAt,
              notes: input.notes ?? null,
            },
            include,
          });
          if (amountPaid > 0) {
            await recordPaymentDelta(tx, {
              workspaceId: auth.workspaceId,
              invoiceId: invoice.id,
              delta: amountPaid,
              actorId: auth.userId,
              method: "CARD",
            });
          }
          return invoice;
        },
      );

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
      schema: {
        tags: ["invoices"],
        summary: "Fetch an invoice",
        security: [{ bearerAuth: [] }],
      },
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
      schema: {
        tags: ["invoices"],
        summary: "Update an invoice",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadInvoiceRow(auth.workspaceId, id);
      const input = parseOrThrow(invoicePatchSchema, request.body);
      const current = existing.status as InvoiceStatus;

      assertInvoiceMutable(current);

      const amount = input.amount ?? existing.amount;
      const amountPaid = input.amountPaid ?? existing.amountPaid;

      if (input.amount !== undefined && input.amount < existing.amountPaid) {
        throw badRequest(
          "The invoice amount cannot be less than the amount already paid",
        );
      }
      if (amountPaid > amount) {
        throw badRequest("Payments cannot exceed the invoice amount");
      }

      let nextStatus: InvoiceStatus;
      if (input.status !== undefined) {
        if (!canTransitionInvoice(current, input.status)) {
          throw conflict(`${current} invoices cannot move to ${input.status}`, {
            from: current,
            to: input.status,
            allowed: INVOICE_STATUS_TRANSITIONS[current],
          });
        }
        assertStatusMatchesMoney(input.status, amount, amountPaid, current);
        nextStatus = input.status;
      } else {
        nextStatus = deriveInvoiceStatus(amount, amountPaid, current);
        if (current === "PAID" && nextStatus !== "PAID") {
          throw conflict("A paid invoice cannot be reopened", {
            from: current,
            to: nextStatus,
            allowed: INVOICE_STATUS_TRANSITIONS[current],
          });
        }
      }

      // DRAFT invoices are never issued; every other status needs an issue date.
      const issuedAt =
        nextStatus === "DRAFT"
          ? null
          : (input.issuedAt ?? existing.issuedAt ?? new Date());
      // Only paid invoices carry a paid date; anything else must clear it.
      const paidAt =
        nextStatus === "PAID"
          ? (input.paidAt ?? existing.paidAt ?? new Date())
          : null;

      const data: Prisma.InvoiceUncheckedUpdateInput = {
        status: nextStatus,
        amount,
        amountPaid,
        paidAt,
        issuedAt,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ?? null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
      };

      const delta = amountPaid - existing.amountPaid;

      const updated = await prisma.$transaction(async (tx) => {
        await recordPaymentDelta(tx, {
          workspaceId: auth.workspaceId,
          invoiceId: existing.id,
          delta,
          actorId: auth.userId,
        });
        return tx.invoice.update({ where: { id: existing.id }, data, include });
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "invoice.updated",
        entityType: "invoice",
        entityId: updated.id,
        ...(delta !== 0 ? { metadata: { amountPaid, delta } } : {}),
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
      const current = existing.status as InvoiceStatus;

      assertInvoiceMutable(current);
      if (input.amountPaid > existing.amount) {
        throw badRequest("Payments cannot exceed the invoice amount");
      }

      const status = paymentStatus(existing, input.amountPaid, current);
      const delta = input.amountPaid - existing.amountPaid;

      const updated = await prisma.$transaction(async (tx) => {
        await recordPaymentDelta(tx, {
          workspaceId: auth.workspaceId,
          invoiceId: existing.id,
          delta,
          actorId: auth.userId,
        });
        return tx.invoice.update({
          where: { id: existing.id },
          data: {
            amountPaid: input.amountPaid,
            status,
            paidAt: status === "PAID" ? (existing.paidAt ?? new Date()) : null,
            issuedAt:
              existing.issuedAt ?? (status === "DRAFT" ? null : new Date()),
          },
          include,
        });
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "invoice.payment",
        entityType: "invoice",
        entityId: updated.id,
        metadata: { amountPaid: input.amountPaid, delta, status },
      });

      return toInvoice(updated);
    },
  );

  app.get(
    "/invoices/:id/payments",
    {
      preHandler: authenticate,
      schema: {
        tags: ["invoices"],
        summary: "List an invoice's payments",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      await loadInvoiceRow(auth.workspaceId, id);
      const rows = await prisma.payment.findMany({
        where: { workspaceId: auth.workspaceId, invoiceId: id },
        include: paymentInclude,
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      });
      return rows.map(toPayment);
    },
  );

  app.post(
    "/invoices/:id/payments",
    {
      preHandler: authenticate,
      schema: {
        tags: ["invoices"],
        summary: "Add a payment to an invoice",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadInvoiceRow(auth.workspaceId, id);
      const input = parseOrThrow(paymentInputSchema, request.body);
      const current = existing.status as InvoiceStatus;

      assertInvoiceMutable(current);
      const amountPaid = existing.amountPaid + input.amount;
      if (amountPaid > existing.amount) {
        throw badRequest("Payments cannot exceed the invoice amount");
      }

      const status = paymentStatus(existing, amountPaid, current);
      const receivedAt = input.receivedAt ?? new Date();

      const updated = await prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            workspaceId: auth.workspaceId,
            invoiceId: existing.id,
            amount: input.amount,
            method: input.method,
            reference: input.reference ?? null,
            receivedAt,
            recordedById: auth.userId,
          },
        });
        return tx.invoice.update({
          where: { id: existing.id },
          data: {
            amountPaid,
            status,
            paidAt: status === "PAID" ? (existing.paidAt ?? new Date()) : null,
            issuedAt:
              existing.issuedAt ?? (status === "DRAFT" ? null : new Date()),
          },
          include,
        });
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "invoice.payment",
        entityType: "invoice",
        entityId: updated.id,
        metadata: { amount: input.amount, method: input.method, status },
      });

      return reply.status(201).send(toInvoice(updated));
    },
  );

  app.delete(
    "/invoices/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["invoices"],
        summary: "Delete an invoice",
        security: [{ bearerAuth: [] }],
      },
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
