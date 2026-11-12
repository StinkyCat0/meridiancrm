import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  CUSTOMER_TYPES,
  EXPENSE_CATEGORIES,
  INDUSTRIES,
  INVOICE_STATUSES,
  OPEN_JOB_STATUSES,
  invoiceIsOverdue,
  type InvoiceStatus,
} from "@meridian/contracts";
import type { Prisma } from "@prisma/client";
import { authenticate, getAuth } from "../lib/auth.js";
import { centsToDecimal, serializeCsv, type CsvColumn } from "../lib/csv.js";
import { prisma } from "../lib/db.js";
import { likeTerm, parseOrThrow, parseTags } from "../lib/http.js";

const MAX_EXPORT_ROWS = 10_000;
const DAY_MS = 86_400_000;

/* -------------------------------------------------------------------------- */
/* Query schemas                                                              */
/* -------------------------------------------------------------------------- */

const invoiceExportQuerySchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  customerId: z.string().trim().max(64).optional(),
  jobId: z.string().trim().max(64).optional(),
  overdue: z.enum(["true", "false"]).optional(),
  q: z.string().trim().max(200).optional(),
});

const paymentExportQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  customerId: z.string().trim().max(64).optional(),
  invoiceId: z.string().trim().max(64).optional(),
  q: z.string().trim().max(200).optional(),
});

const expenseExportQuerySchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  jobId: z.string().trim().max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(200).optional(),
});

const customerExportQuerySchema = z.object({
  archive: z.enum(["active", "archived", "all"]).default("active"),
  industry: z.enum(INDUSTRIES).optional(),
  customerType: z.enum(CUSTOMER_TYPES).optional(),
  q: z.string().trim().max(200).optional(),
});

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

function dayRange(from?: Date, to?: Date): { gte?: Date; lt?: Date } {
  const range: { gte?: Date; lt?: Date } = {};
  if (from) {
    range.gte = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
    );
  }
  if (to) {
    const dayStart = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
    );
    range.lt = new Date(dayStart.getTime() + DAY_MS);
  }
  return range;
}

function sendCsv(
  reply: FastifyReply,
  kind: string,
  body: string,
): FastifyReply {
  const stamp = new Date().toISOString().slice(0, 10);
  return reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename=${kind}-${stamp}.csv`)
    .header("Cache-Control", "no-store")
    .send(body);
}

/* -------------------------------------------------------------------------- */
/* Invoices                                                                   */
/* -------------------------------------------------------------------------- */

const invoiceExportInclude = {
  customer: { select: { name: true } },
  location: { select: { label: true } },
} satisfies Prisma.InvoiceInclude;

type InvoiceExportRow = Prisma.InvoiceGetPayload<{
  include: typeof invoiceExportInclude;
}>;

function invoiceColumns(now: Date): CsvColumn<InvoiceExportRow>[] {
  return [
    { header: "number", value: (row) => row.number },
    { header: "status", value: (row) => row.status },
    { header: "title", value: (row) => row.title },
    { header: "customer", value: (row) => row.customer.name },
    { header: "location", value: (row) => row.location?.label ?? "" },
    { header: "issuedAt", value: (row) => row.issuedAt },
    { header: "dueAt", value: (row) => row.dueAt },
    { header: "amount", value: (row) => centsToDecimal(row.amount) },
    { header: "amountPaid", value: (row) => centsToDecimal(row.amountPaid) },
    {
      header: "balance",
      value: (row) => centsToDecimal(Math.max(0, row.amount - row.amountPaid)),
    },
    {
      header: "overdue",
      value: (row) =>
        invoiceIsOverdue(
          row.status as InvoiceStatus,
          Math.max(0, row.amount - row.amountPaid),
          row.dueAt,
          now,
        ),
    },
  ];
}

async function exportInvoices(
  workspaceId: string,
  query: z.infer<typeof invoiceExportQuerySchema>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const where: Prisma.InvoiceWhereInput = {
    workspaceId,
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
    const status = query.status;
    if (status && status !== "SENT" && status !== "PARTIAL") {
      where.status = { in: [] };
    } else {
      where.status = status ?? { in: ["SENT", "PARTIAL"] };
    }
    where.dueAt = { lt: new Date() };
    where.amount = { gt: 0 };
  }

  const now = new Date();
  const rows = await prisma.invoice.findMany({
    where,
    include: invoiceExportInclude,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: MAX_EXPORT_ROWS,
  });

  return sendCsv(reply, "invoices", serializeCsv(invoiceColumns(now), rows));
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                   */
/* -------------------------------------------------------------------------- */

const paymentExportInclude = {
  invoice: { select: { number: true, customer: { select: { name: true } } } },
  recordedBy: { select: { name: true } },
} satisfies Prisma.PaymentInclude;

type PaymentExportRow = Prisma.PaymentGetPayload<{
  include: typeof paymentExportInclude;
}>;

const paymentColumns: CsvColumn<PaymentExportRow>[] = [
  { header: "receivedAt", value: (row) => row.receivedAt },
  { header: "invoiceNumber", value: (row) => row.invoice.number },
  { header: "customer", value: (row) => row.invoice.customer.name },
  { header: "amount", value: (row) => centsToDecimal(row.amount) },
  { header: "method", value: (row) => row.method },
  { header: "reference", value: (row) => row.reference ?? "" },
  { header: "recordedBy", value: (row) => row.recordedBy?.name ?? "" },
];

async function exportPayments(
  workspaceId: string,
  query: z.infer<typeof paymentExportQuerySchema>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const receivedAt = dayRange(query.from, query.to);
  const where: Prisma.PaymentWhereInput = {
    workspaceId,
    ...(Object.keys(receivedAt).length > 0 ? { receivedAt } : {}),
    ...(query.customerId
      ? { invoice: { is: { customerId: query.customerId } } }
      : {}),
    ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
  };

  if (query.q) {
    const term = likeTerm(query.q);
    where.OR = [
      { reference: { contains: term } },
      { invoice: { is: { number: { contains: term } } } },
      { invoice: { is: { customer: { is: { name: { contains: term } } } } } },
    ];
  }

  const rows = await prisma.payment.findMany({
    where,
    include: paymentExportInclude,
    orderBy: [{ receivedAt: "desc" }, { id: "asc" }],
    take: MAX_EXPORT_ROWS,
  });

  return sendCsv(reply, "payments", serializeCsv(paymentColumns, rows));
}

/* -------------------------------------------------------------------------- */
/* Expenses                                                                   */
/* -------------------------------------------------------------------------- */

const expenseExportInclude = {
  job: { select: { number: true } },
  user: { select: { name: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseExportRow = Prisma.ExpenseGetPayload<{
  include: typeof expenseExportInclude;
}>;

const expenseColumns: CsvColumn<ExpenseExportRow>[] = [
  { header: "incurredAt", value: (row) => row.incurredAt },
  { header: "category", value: (row) => row.category },
  { header: "vendor", value: (row) => row.vendor ?? "" },
  { header: "description", value: (row) => row.description },
  { header: "amount", value: (row) => centsToDecimal(row.amount) },
  { header: "jobNumber", value: (row) => row.job?.number ?? "" },
  { header: "user", value: (row) => row.user?.name ?? "" },
];

async function exportExpenses(
  workspaceId: string,
  query: z.infer<typeof expenseExportQuerySchema>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const incurredAt = dayRange(query.from, query.to);
  const where: Prisma.ExpenseWhereInput = {
    workspaceId,
    ...(query.category ? { category: query.category } : {}),
    ...(query.jobId ? { jobId: query.jobId } : {}),
    ...(Object.keys(incurredAt).length > 0 ? { incurredAt } : {}),
  };

  if (query.q) {
    const term = likeTerm(query.q);
    where.OR = [
      { description: { contains: term } },
      { vendor: { contains: term } },
    ];
  }

  const rows = await prisma.expense.findMany({
    where,
    include: expenseExportInclude,
    orderBy: [{ incurredAt: "desc" }, { id: "asc" }],
    take: MAX_EXPORT_ROWS,
  });

  return sendCsv(reply, "expenses", serializeCsv(expenseColumns, rows));
}

/* -------------------------------------------------------------------------- */
/* Customers                                                                  */
/* -------------------------------------------------------------------------- */

const customerExportInclude = {
  _count: {
    select: {
      jobs: {
        where: {
          status: { in: [...OPEN_JOB_STATUSES] },
        },
      },
    },
  },
} satisfies Prisma.CompanyInclude;

type CustomerExportRow = Prisma.CompanyGetPayload<{
  include: typeof customerExportInclude;
}>;

const customerColumns: CsvColumn<CustomerExportRow>[] = [
  { header: "name", value: (row) => row.name },
  { header: "type", value: (row) => row.customerType },
  { header: "vertical", value: (row) => row.industry ?? "" },
  { header: "email", value: (row) => row.email ?? "" },
  { header: "phone", value: (row) => row.phone ?? "" },
  { header: "address", value: (row) => row.address ?? "" },
  { header: "tags", value: (row) => parseTags(row.tags).join(", ") },
  { header: "openJobs", value: (row) => row._count.jobs },
  { header: "archived", value: (row) => row.archived },
];

async function exportCustomers(
  workspaceId: string,
  query: z.infer<typeof customerExportQuerySchema>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const where: Prisma.CompanyWhereInput = {
    workspaceId,
    ...(query.archive === "all"
      ? {}
      : { archived: query.archive === "archived" }),
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

  const rows = await prisma.company.findMany({
    where,
    include: customerExportInclude,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: MAX_EXPORT_ROWS,
  });

  return sendCsv(reply, "customers", serializeCsv(customerColumns, rows));
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

export async function exportsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/exports/invoices.csv",
    {
      preHandler: authenticate,
      schema: {
        tags: ["exports"],
        summary: "Export invoices as CSV",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const query = parseOrThrow(invoiceExportQuerySchema, request.query);
      return exportInvoices(auth.workspaceId, query, reply);
    },
  );

  app.get(
    "/exports/payments.csv",
    {
      preHandler: authenticate,
      schema: {
        tags: ["exports"],
        summary: "Export payments as CSV",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const query = parseOrThrow(paymentExportQuerySchema, request.query);
      return exportPayments(auth.workspaceId, query, reply);
    },
  );

  app.get(
    "/exports/expenses.csv",
    {
      preHandler: authenticate,
      schema: {
        tags: ["exports"],
        summary: "Export expenses as CSV",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const query = parseOrThrow(expenseExportQuerySchema, request.query);
      return exportExpenses(auth.workspaceId, query, reply);
    },
  );

  app.get(
    "/exports/customers.csv",
    {
      preHandler: authenticate,
      schema: {
        tags: ["exports"],
        summary: "Export customers as CSV",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const query = parseOrThrow(customerExportQuerySchema, request.query);
      return exportCustomers(auth.workspaceId, query, reply);
    },
  );
}
