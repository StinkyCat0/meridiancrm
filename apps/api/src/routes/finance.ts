import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  EXPENSE_CATEGORIES,
  expenseInputSchema,
  expenseListQuerySchema,
  expensePatchSchema,
  financeRangeSchema,
  paymentListQuerySchema,
  type CategoryMargin,
  type CustomerRevenue,
  type CustomerSummary,
  type Expense,
  type ExpenseCategory,
  type FinanceMonth,
  type FinanceRange,
  type FinanceSummary,
  type Payment,
  type PaymentMethod,
  type PublicUser,
  type TechnicianRevenue,
} from "@meridian/contracts";
import type { Prisma } from "@prisma/client";
import { authenticate, getAuth, requireRole } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/db.js";
import { badRequest, likeTerm, notFound, pageMeta, parseOrThrow } from "../lib/http.js";
import { customerSelect, toCustomerSummary, userSelect } from "../lib/service-ops.js";

const DAY_MS = 86_400_000;
const DEFAULT_RANGE_DAYS = 90;
const MAX_RANGE_DAYS = 366;
const TOP_CUSTOMER_LIMIT = 5;
const MIN_SERIES_MONTHS = 6;
const UNCATEGORIZED = "Uncategorized";

const idParamsSchema = z.object({ id: z.string().trim().min(1).max(64) });

/* -------------------------------------------------------------------------- */
/* Serializers                                                                */
/* -------------------------------------------------------------------------- */

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

const expenseInclude = {
  job: { select: { number: true } },
  user: { select: userSelect },
} satisfies Prisma.ExpenseInclude;

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    category: row.category as ExpenseCategory,
    vendor: row.vendor,
    description: row.description,
    amount: row.amount,
    incurredAt: row.incurredAt.toISOString(),
    jobId: row.jobId,
    jobNumber: row.job?.number ?? null,
    user: row.user,
    receiptUrl: row.receiptUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Date helpers                                                               */
/* -------------------------------------------------------------------------- */

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Inclusive day bounds translated to a half-open instant range. */
function dayRange(from?: Date, to?: Date): { gte?: Date; lt?: Date } {
  const range: { gte?: Date; lt?: Date } = {};
  if (from) range.gte = startOfUtcDay(from);
  if (to) range.lt = addDays(startOfUtcDay(to), 1);
  return range;
}

interface ResolvedRange {
  start: Date;
  endExclusive: Date;
  endDay: Date;
  range: FinanceRange;
}

function resolveSummaryRange(from?: Date, to?: Date): ResolvedRange {
  const endDay = startOfUtcDay(to ?? new Date());
  const requestedStart = startOfUtcDay(from ?? new Date(endDay.getTime() - DEFAULT_RANGE_DAYS * DAY_MS));
  if (requestedStart.getTime() > endDay.getTime()) {
    throw badRequest("`from` must be on or before `to`");
  }

  const earliestStart = new Date(endDay.getTime() - (MAX_RANGE_DAYS - 1) * DAY_MS);
  const start = requestedStart < earliestStart ? earliestStart : requestedStart;
  const endExclusive = addDays(endDay, 1);

  return {
    start,
    endExclusive,
    endDay,
    range: {
      from: start.toISOString(),
      to: new Date(endExclusive.getTime() - 1).toISOString(),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Numeric helpers                                                            */
/* -------------------------------------------------------------------------- */

function marginPct(part: number, base: number): number | null {
  if (base === 0) return null;
  const rounded = Math.round((part / base) * 1000) / 10;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Split `total` across weights with cumulative rounding so the parts always add
 * back up to `total` (largest-remainder style, deterministic order).
 */
function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum <= 0) return weights.map(() => 0);

  const parts: number[] = [];
  let allocated = 0;
  for (let index = 0; index < weights.length; index += 1) {
    if (index === weights.length - 1) {
      parts.push(total - allocated);
      continue;
    }
    const share = Math.round((total * (weights[index] ?? 0)) / sum);
    allocated += share;
    parts.push(share);
  }
  return parts;
}

function sortByRevenueThenName<T extends { revenue: number }>(
  rows: T[],
  nameOf: (row: T) => string,
): T[] {
  return rows.sort((a, b) => b.revenue - a.revenue || nameOf(a).localeCompare(nameOf(b)));
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

const summaryPaymentSelect = {
  id: true,
  invoiceId: true,
  amount: true,
  receivedAt: true,
  invoice: {
    select: {
      amount: true,
      jobId: true,
      customerId: true,
      customer: { select: customerSelect },
    },
  },
} satisfies Prisma.PaymentSelect;

const summaryJobSelect = {
  id: true,
  assignee: { select: userSelect },
  lineItems: {
    select: {
      id: true,
      quantity: true,
      unitCost: true,
      total: true,
      service: { select: { category: true } },
    },
  },
} satisfies Prisma.JobSelect;

type SummaryJob = Prisma.JobGetPayload<{ select: typeof summaryJobSelect }>;

interface CategoryAccumulator {
  revenue: number;
  cost: number;
  jobs: Set<string>;
}

interface TechnicianAccumulator {
  user: PublicUser;
  jobs: Set<string>;
  revenue: number;
  margin: number;
}

interface CustomerAccumulator {
  customer: CustomerSummary;
  revenue: number;
  jobs: Set<string>;
}

interface MonthAccumulator {
  revenue: number;
  expenses: number;
  cogs: number;
}

function buildMonthSeries(start: Date, endDay: Date): Map<string, MonthAccumulator> {
  const rangeMonthStart = startOfUtcMonth(start);
  const minimumStart = addUtcMonths(startOfUtcMonth(endDay), -(MIN_SERIES_MONTHS - 1));
  const seriesStart = rangeMonthStart < minimumStart ? rangeMonthStart : minimumStart;

  const series = new Map<string, MonthAccumulator>();
  for (let cursor = seriesStart; cursor.getTime() <= endDay.getTime(); cursor = addUtcMonths(cursor, 1)) {
    series.set(monthKey(cursor), { revenue: 0, expenses: 0, cogs: 0 });
  }
  return series;
}

async function loadSummary(workspaceId: string, from?: Date, to?: Date): Promise<FinanceSummary> {
  const { start, endExclusive, endDay, range } = resolveSummaryRange(from, to);
  const now = new Date();

  const [workspace, payments, expenses, invoiced, openInvoices] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { currency: true },
    }),
    prisma.payment.findMany({
      where: { workspaceId, receivedAt: { gte: start, lt: endExclusive } },
      select: summaryPaymentSelect,
      orderBy: { receivedAt: "asc" },
    }),
    prisma.expense.findMany({
      where: { workspaceId, incurredAt: { gte: start, lt: endExclusive } },
      select: { category: true, amount: true, incurredAt: true },
      orderBy: { incurredAt: "asc" },
    }),
    prisma.invoice.aggregate({
      where: {
        workspaceId,
        status: { not: "VOID" },
        issuedAt: { gte: start, lt: endExclusive },
      },
      _sum: { amount: true },
    }),
    prisma.invoice.findMany({
      where: { workspaceId, status: { notIn: ["DRAFT", "VOID"] } },
      select: { customerId: true, amount: true, amountPaid: true, dueAt: true },
    }),
  ]);

  if (!workspace) throw notFound("Workspace");

  const jobIds = Array.from(
    new Set(
      payments
        .map((payment) => payment.invoice.jobId)
        .filter((jobId): jobId is string => jobId !== null),
    ),
  );

  const jobs: SummaryJob[] =
    jobIds.length > 0
      ? await prisma.job.findMany({
          where: { workspaceId, id: { in: jobIds } },
          select: summaryJobSelect,
        })
      : [];
  const jobMap = new Map(jobs.map((job) => [job.id, job] as const));

  const months = buildMonthSeries(start, endDay);
  const categoryStats = new Map<string, CategoryAccumulator>();
  const technicianStats = new Map<string, TechnicianAccumulator>();
  const customerStats = new Map<string, CustomerAccumulator>();

  let revenue = 0;
  let collected = 0;
  let refunds = 0;
  let totalCogs = 0;
  const paidInvoiceIds = new Set<string>();

  for (const payment of payments) {
    const amount = payment.amount;
    revenue += amount;
    if (amount > 0) collected += amount;
    else if (amount < 0) refunds += -amount;
    paidInvoiceIds.add(payment.invoiceId);

    const month = months.get(monthKey(payment.receivedAt));
    if (month) month.revenue += amount;

    const invoice = payment.invoice;
    const job = invoice.jobId ? jobMap.get(invoice.jobId) : undefined;

    const lineCosts = (job?.lineItems ?? []).map((line) => ({
      total: line.total,
      cost: Math.round(line.quantity * line.unitCost),
      category: line.service?.category?.trim() || UNCATEGORIZED,
    }));
    const totalLineTotal = lineCosts.reduce((acc, line) => acc + line.total, 0);
    const totalLineCost = lineCosts.reduce((acc, line) => acc + line.cost, 0);

    // COGS: the job's line-item cost prorated to the share of the invoice this
    // payment represents. Negative payments (refunds) release cost symmetrically.
    let paymentCost = 0;
    if (job && invoice.amount > 0 && totalLineCost > 0) {
      const ratio = Math.max(-1, Math.min(1, amount / invoice.amount));
      paymentCost = Math.round(totalLineCost * ratio);
    }

    totalCogs += paymentCost;
    if (month) month.cogs += paymentCost;

    if (job && totalLineTotal > 0) {
      const revenueShares = allocate(amount, lineCosts.map((line) => line.total));
      const costShares = allocate(paymentCost, lineCosts.map((line) => line.cost));

      lineCosts.forEach((line, index) => {
        const lineRevenue = revenueShares[index] ?? 0;
        const lineCost = costShares[index] ?? 0;
        if (lineRevenue === 0 && lineCost === 0) return;

        const entry =
          categoryStats.get(line.category) ??
          (() => {
            const created: CategoryAccumulator = { revenue: 0, cost: 0, jobs: new Set<string>() };
            categoryStats.set(line.category, created);
            return created;
          })();
        entry.revenue += lineRevenue;
        entry.cost += lineCost;
        if (job) entry.jobs.add(job.id);
      });
    }

    const technician = job?.assignee;
    if (technician) {
      const entry =
        technicianStats.get(technician.id) ??
        (() => {
          const created: TechnicianAccumulator = {
            user: technician,
            jobs: new Set<string>(),
            revenue: 0,
            margin: 0,
          };
          technicianStats.set(technician.id, created);
          return created;
        })();
      entry.revenue += amount;
      entry.margin += amount - paymentCost;
      if (job) entry.jobs.add(job.id);
    }

    const customerId = invoice.customerId;
    const entry =
      customerStats.get(customerId) ??
      (() => {
        const created: CustomerAccumulator = {
          customer: toCustomerSummary(invoice.customer),
          revenue: 0,
          jobs: new Set<string>(),
        };
        customerStats.set(customerId, created);
        return created;
      })();
    entry.revenue += amount;
    if (job) entry.jobs.add(job.id);
  }

  const expensesByCategoryMap = new Map<ExpenseCategory, number>();
  let expensesTotal = 0;

  for (const expense of expenses) {
    expensesTotal += expense.amount;
    const category = expense.category as ExpenseCategory;
    expensesByCategoryMap.set(category, (expensesByCategoryMap.get(category) ?? 0) + expense.amount);
    const month = months.get(monthKey(expense.incurredAt));
    if (month) month.expenses += expense.amount;
  }

  const balanceByCustomer = new Map<string, number>();
  let outstanding = 0;
  let overdueAmount = 0;

  for (const invoice of openInvoices) {
    const balance = Math.max(0, invoice.amount - invoice.amountPaid);
    if (balance === 0) continue;
    outstanding += balance;
    balanceByCustomer.set(
      invoice.customerId,
      (balanceByCustomer.get(invoice.customerId) ?? 0) + balance,
    );
    if (invoice.dueAt && invoice.dueAt.getTime() < now.getTime()) {
      overdueAmount += balance;
    }
  }

  const monthly: FinanceMonth[] = Array.from(months.entries()).map(([month, values]) => ({
    month,
    revenue: values.revenue,
    expenses: values.expenses,
    profit: values.revenue - values.expenses - values.cogs,
  }));

  const expensesByCategory = Array.from(expensesByCategoryMap.entries())
    .filter(([, amount]) => amount !== 0)
    .map(([category, amount]) => ({ category, amount }))
    .sort(
      (a, b) =>
        b.amount - a.amount ||
        EXPENSE_CATEGORIES.indexOf(a.category) - EXPENSE_CATEGORIES.indexOf(b.category),
    );

  const serviceMargins: CategoryMargin[] = sortByRevenueThenName(
    Array.from(categoryStats.entries()).map(([category, values]) => {
      const margin = values.revenue - values.cost;
      return {
        category,
        revenue: values.revenue,
        cost: values.cost,
        margin,
        marginPct: marginPct(margin, values.revenue),
        jobs: values.jobs.size,
      };
    }),
    (row) => row.category,
  );

  const technicianRevenue: TechnicianRevenue[] = sortByRevenueThenName(
    Array.from(technicianStats.values()).map((values) => ({
      user: values.user,
      jobs: values.jobs.size,
      revenue: values.revenue,
      margin: values.margin,
    })),
    (row) => row.user.name,
  );

  const topCustomers: CustomerRevenue[] = sortByRevenueThenName(
    Array.from(customerStats.values()).map((values) => ({
      customer: values.customer,
      revenue: values.revenue,
      jobs: values.jobs.size,
      balance: balanceByCustomer.get(values.customer.id) ?? 0,
    })),
    (row) => row.customer.name,
  ).slice(0, TOP_CUSTOMER_LIMIT);

  // Gross profit is revenue less service cost of goods sold. Operating
  // expenses are reported separately and are not netted into the margin.
  const grossProfit = revenue - totalCogs;

  return {
    range,
    currency: workspace.currency,
    revenue,
    collected,
    refunds,
    invoiced: invoiced._sum.amount ?? 0,
    outstanding,
    overdueAmount,
    expenses: expensesTotal,
    grossProfit,
    grossMarginPct: marginPct(grossProfit, revenue),
    averageTicket: paidInvoiceIds.size > 0 ? Math.round(revenue / paidInvoiceIds.size) : 0,
    paymentCount: payments.length,
    monthly,
    expensesByCategory,
    serviceMargins,
    technicianRevenue,
    topCustomers,
  };
}

/* -------------------------------------------------------------------------- */
/* Expense helpers                                                            */
/* -------------------------------------------------------------------------- */

async function assertJob(workspaceId: string, jobId: string): Promise<void> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, workspaceId },
    select: { id: true },
  });
  if (!job) throw notFound("Job");
}

async function assertWorkspaceUser(workspaceId: string, userId: string): Promise<void> {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true },
  });
  if (!membership) throw badRequest("User must be a member of this workspace");
}

async function validateExpenseRefs(
  workspaceId: string,
  jobId: string | null | undefined,
  userId: string | null | undefined,
): Promise<void> {
  if (jobId) await assertJob(workspaceId, jobId);
  if (userId) await assertWorkspaceUser(workspaceId, userId);
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

export async function financeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/finance/summary",
    {
      preHandler: authenticate,
      schema: {
        tags: ["finance"],
        summary: "Workspace financial summary",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(financeRangeSchema, request.query);
      return loadSummary(auth.workspaceId, query.from ?? undefined, query.to ?? undefined);
    },
  );

  app.get(
    "/finance/payments",
    {
      preHandler: authenticate,
      schema: {
        tags: ["finance"],
        summary: "List payments",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const query = parseOrThrow(paymentListQuerySchema, request.query);
      const receivedAt = dayRange(query.from ?? undefined, query.to ?? undefined);

      const where: Prisma.PaymentWhereInput = {
        workspaceId: auth.workspaceId,
        ...(Object.keys(receivedAt).length > 0 ? { receivedAt } : {}),
        ...(query.customerId ? { invoice: { is: { customerId: query.customerId } } } : {}),
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

      const allowedSorts = ["receivedAt", "amount", "createdAt"] as const;
      const sortField = allowedSorts.find((field) => field === query.sort) ?? "receivedAt";

      const [rows, total] = await prisma.$transaction([
        prisma.payment.findMany({
          where,
          include: paymentInclude,
          orderBy: { [sortField]: query.order } as Prisma.PaymentOrderByWithRelationInput,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.payment.count({ where }),
      ]);

      return reply.status(200).send({
        data: rows.map(toPayment),
        meta: pageMeta(total, query.page, query.pageSize),
      });
    },
  );

  app.get(
    "/finance/expenses",
    {
      preHandler: authenticate,
      schema: {
        tags: ["finance"],
        summary: "List expenses",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const query = parseOrThrow(expenseListQuerySchema, request.query);
      const incurredAt = dayRange(query.from ?? undefined, query.to ?? undefined);

      const where: Prisma.ExpenseWhereInput = {
        workspaceId: auth.workspaceId,
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

      const allowedSorts = ["incurredAt", "amount", "createdAt"] as const;
      const sortField = allowedSorts.find((field) => field === query.sort) ?? "incurredAt";

      const [rows, total] = await prisma.$transaction([
        prisma.expense.findMany({
          where,
          include: expenseInclude,
          orderBy: { [sortField]: query.order } as Prisma.ExpenseOrderByWithRelationInput,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.expense.count({ where }),
      ]);

      return reply.status(200).send({
        data: rows.map(toExpense),
        meta: pageMeta(total, query.page, query.pageSize),
      });
    },
  );

  app.post(
    "/finance/expenses",
    {
      preHandler: authenticate,
      schema: {
        tags: ["finance"],
        summary: "Record an expense",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const input = parseOrThrow(expenseInputSchema, request.body);
      await validateExpenseRefs(auth.workspaceId, input.jobId, input.userId);

      const created = await prisma.expense.create({
        data: {
          workspaceId: auth.workspaceId,
          category: input.category,
          vendor: input.vendor ?? null,
          description: input.description,
          amount: input.amount,
          incurredAt: input.incurredAt ?? new Date(),
          jobId: input.jobId ?? null,
          userId: input.userId ?? null,
          receiptUrl: input.receiptUrl ?? null,
        },
        include: expenseInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "expense.created",
        entityType: "expense",
        entityId: created.id,
        metadata: { category: created.category, amount: created.amount },
      });

      return reply.status(201).send(toExpense(created));
    },
  );

  app.patch(
    "/finance/expenses/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["finance"],
        summary: "Update an expense",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const input = parseOrThrow(expensePatchSchema, request.body);

      const existing = await prisma.expense.findFirst({
        where: { id, workspaceId: auth.workspaceId },
        select: { id: true },
      });
      if (!existing) throw notFound("Expense");

      await validateExpenseRefs(auth.workspaceId, input.jobId, input.userId);

      const data: Prisma.ExpenseUncheckedUpdateInput = {};
      if (input.category !== undefined) data.category = input.category;
      if (input.vendor !== undefined) data.vendor = input.vendor;
      if (input.description !== undefined) data.description = input.description;
      if (input.amount !== undefined) data.amount = input.amount;
      if (input.incurredAt) data.incurredAt = input.incurredAt;
      if (input.jobId !== undefined) data.jobId = input.jobId;
      if (input.userId !== undefined) data.userId = input.userId;
      if (input.receiptUrl !== undefined) data.receiptUrl = input.receiptUrl;

      const updated = await prisma.expense.update({
        where: { id: existing.id },
        data,
        include: expenseInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "expense.updated",
        entityType: "expense",
        entityId: updated.id,
        metadata: { category: updated.category, amount: updated.amount },
      });

      return toExpense(updated);
    },
  );

  app.delete(
    "/finance/expenses/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["finance"],
        summary: "Delete an expense",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const { id } = parseOrThrow(idParamsSchema, request.params);

      const existing = await prisma.expense.findFirst({
        where: { id, workspaceId: auth.workspaceId },
        select: { id: true, category: true, amount: true },
      });
      if (!existing) throw notFound("Expense");

      await prisma.expense.delete({ where: { id: existing.id } });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "expense.deleted",
        entityType: "expense",
        entityId: existing.id,
        metadata: { category: existing.category, amount: existing.amount },
      });

      return reply.status(204).send();
    },
  );
}
