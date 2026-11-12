import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AgingSummary,
  FinanceSummary,
  Payment,
} from "@meridian/contracts";
import { prisma } from "../lib/db.js";
import {
  authHeaders,
  createTestApp,
  registerAccount,
  resetDatabase,
  type TestAccount,
} from "../test/helpers.js";

let app: FastifyInstance;
let owner: TestAccount;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  owner = await registerAccount(app);
});

function as(target: TestAccount = owner) {
  return authHeaders(target);
}

function dayOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function createCustomer(target: TestAccount, name = "Cedar & Co") {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/companies",
    headers: as(target),
    payload: {
      name,
      customerType: "RESIDENTIAL",
      email: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}@example.com`,
      phone: "503-555-0100",
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; name: string };
}

async function createLocation(target: TestAccount, customerId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/locations",
    headers: as(target),
    payload: {
      customerId,
      label: "Main",
      line1: "412 Alder Street",
      city: "Portland",
      state: "OR",
      postalCode: "97205",
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

async function createService(
  target: TestAccount,
  payload: { name: string; category: string; price: number; cost: number },
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/services",
    headers: as(target),
    payload: {
      unit: "VISIT",
      durationMinutes: 90,
      taxable: true,
      ...payload,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; name: string; category: string };
}

async function createJob(
  target: TestAccount,
  payload: {
    title: string;
    customerId: string;
    locationId: string;
    assigneeId?: string | null;
    lineItems?: Array<{
      serviceId?: string | null;
      name: string;
      quantity?: number;
      unitPrice: number;
      unitCost?: number;
    }>;
  },
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/jobs",
    headers: as(target),
    payload: {
      status: "COMPLETED",
      priority: "NORMAL",
      durationMinutes: 90,
      assigneeId: target.userId,
      lineItems: [],
      ...payload,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; number: string; total: number };
}

async function createInvoice(
  target: TestAccount,
  payload: {
    title: string;
    jobId: string;
    amount: number;
    status?: string;
    issuedAt?: string | null;
    dueAt?: string | null;
  },
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/invoices",
    headers: as(target),
    payload: {
      status: "SENT",
      issuedAt: new Date().toISOString(),
      ...payload,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; number: string; amount: number };
}

/** Payments are inserted directly until the invoice payment route lands. */
async function addPayment(
  target: TestAccount,
  invoiceId: string,
  amount: number,
  options: { method?: string; receivedAt?: Date; reference?: string } = {},
) {
  const payment = await prisma.payment.create({
    data: {
      workspaceId: target.workspaceId,
      invoiceId,
      amount,
      method: options.method ?? (amount < 0 ? "ADJUSTMENT" : "CARD"),
      reference: options.reference ?? null,
      receivedAt: options.receivedAt ?? new Date(),
      recordedById: target.userId,
    },
  });
  const totals = await prisma.payment.aggregate({
    where: { invoiceId },
    _sum: { amount: true },
  });
  const amountPaid = totals._sum.amount ?? 0;
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
  });
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid,
      status:
        amountPaid >= invoice.amount
          ? "PAID"
          : amountPaid > 0
            ? "PARTIAL"
            : "SENT",
    },
  });
  return payment;
}

async function createExpense(
  target: TestAccount,
  payload: Partial<{
    category: string;
    vendor: string | null;
    description: string;
    amount: number;
    incurredAt: string | null;
    jobId: string | null;
    userId: string | null;
    receiptUrl: string | null;
  }> = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/finance/expenses",
    headers: as(target),
    payload: {
      category: "SUPPLIES",
      description: "Microfiber towels",
      amount: 1500,
      ...payload,
    },
  });
}

async function getSummary(
  target: TestAccount,
  query = "",
): Promise<FinanceSummary> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/finance/summary${query}`,
    headers: as(target),
  });
  expect(response.statusCode).toBe(200);
  return response.json() as FinanceSummary;
}

async function getAging(target: TestAccount): Promise<AgingSummary> {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/finance/aging",
    headers: as(target),
  });
  expect(response.statusCode).toBe(200);
  return response.json() as AgingSummary;
}

async function seedAgingJob(target: TestAccount, name = "Aging Co") {
  const customer = await createCustomer(target, name);
  const location = await createLocation(target, customer.id);
  const job = await createJob(target, {
    title: `${name} visit`,
    customerId: customer.id,
    locationId: location.id,
  });
  return { customer, location, job };
}

async function seedJobInvoice(target: TestAccount, amount = 15000) {
  const customer = await createCustomer(target);
  const location = await createLocation(target, customer.id);
  const windows = await createService(target, {
    name: "Window clean",
    category: "Windows",
    price: 10000,
    cost: 4000,
  });
  const gutters = await createService(target, {
    name: "Gutter clean",
    category: "Gutters",
    price: 5000,
    cost: 2000,
  });
  const job = await createJob(target, {
    title: "Exterior refresh",
    customerId: customer.id,
    locationId: location.id,
    lineItems: [
      {
        serviceId: windows.id,
        name: windows.name,
        unitPrice: 10000,
        unitCost: 4000,
      },
      {
        serviceId: gutters.id,
        name: gutters.name,
        unitPrice: 5000,
        unitCost: 2000,
      },
    ],
  });
  const invoice = await createInvoice(target, {
    title: "Exterior refresh",
    jobId: job.id,
    amount,
    dueAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  });
  return { customer, location, job, invoice, windows, gutters };
}

function monthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

describe("finance summary", () => {
  it("aggregates payments, refunds, COGS, expenses and service margins", async () => {
    const { customer, job, invoice } = await seedJobInvoice(owner, 15000);
    await addPayment(owner, invoice.id, 10000);
    await addPayment(owner, invoice.id, -2000, { method: "ADJUSTMENT" });
    await createExpense(owner, {
      amount: 1500,
      category: "SUPPLIES",
      jobId: job.id,
    });

    const summary = await getSummary(
      owner,
      `?from=${dayOffset(-10)}&to=${dayOffset(0)}`,
    );

    expect(summary.currency).toBe("USD");
    expect(summary.range.from).toBeTruthy();
    expect(summary.range.to).toBeTruthy();
    expect(summary.revenue).toBe(8000);
    expect(summary.collected).toBe(10000);
    expect(summary.refunds).toBe(2000);
    expect(summary.invoiced).toBe(15000);
    expect(summary.outstanding).toBe(7000);
    expect(summary.overdueAmount).toBe(7000);
    expect(summary.expenses).toBe(1500);
    expect(summary.paymentCount).toBe(2);
    expect(summary.averageTicket).toBe(8000);

    // Job cost 6000; 10000/15000 collected = 4000, refund releases 800.
    // Gross profit excludes operating expenses; the $1,500 expense is separate.
    expect(summary.grossProfit).toBe(8000 - 3200);
    expect(summary.grossMarginPct).toBe(60);

    const windows = summary.serviceMargins.find(
      (row) => row.category === "Windows",
    );
    expect(windows).toMatchObject({
      revenue: 5334,
      cost: 2134,
      margin: 3200,
      marginPct: 60,
      jobs: 1,
    });
    const gutters = summary.serviceMargins.find(
      (row) => row.category === "Gutters",
    );
    expect(gutters).toMatchObject({
      revenue: 2666,
      cost: 1066,
      margin: 1600,
      marginPct: 60,
      jobs: 1,
    });

    expect(summary.expensesByCategory).toEqual([
      { category: "SUPPLIES", amount: 1500 },
    ]);
    expect(summary.technicianRevenue).toEqual([
      {
        user: {
          id: owner.userId,
          name: "Test Owner",
          email: owner.email,
          avatarUrl: null,
        },
        jobs: 1,
        revenue: 8000,
        margin: 4800,
      },
    ]);
    expect(summary.topCustomers).toEqual([
      {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: "503-555-0100",
          customerType: "RESIDENTIAL",
        },
        revenue: 8000,
        jobs: 1,
        balance: 7000,
      },
    ]);

    const currentMonth = summary.monthly.find(
      (row) => row.month === monthKey(),
    );
    expect(currentMonth).toEqual({
      month: monthKey(),
      revenue: 8000,
      expenses: 1500,
      profit: 3300,
    });
    expect(summary.monthly).toHaveLength(6);

    const paymentsResponse = await app.inject({
      method: "GET",
      url: `/api/v1/finance/payments?invoiceId=${invoice.id}&pageSize=10`,
      headers: as(owner),
    });
    expect(paymentsResponse.statusCode).toBe(200);
    const paymentsBody = paymentsResponse.json() as {
      data: Payment[];
      meta: {
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      };
    };
    expect(paymentsBody.meta).toEqual({
      total: 2,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
    expect(
      paymentsBody.data.map((row) => row.amount).sort((a, b) => a - b),
    ).toEqual([-2000, 10000]);

    const received = paymentsBody.data.find((row) => row.amount === 10000);
    expect(received).toMatchObject({
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      method: "CARD",
      recordedBy: { id: owner.userId, email: owner.email },
    });
    expect(received?.customer.id).toBe(customer.id);

    const byCustomer = await app.inject({
      method: "GET",
      url: `/api/v1/finance/payments?customerId=${customer.id}`,
      headers: as(owner),
    });
    expect(byCustomer.statusCode).toBe(200);
    expect(byCustomer.json().meta.total).toBe(2);
  });

  it("allocates a job's cost once across multiple invoices", async () => {
    const { job, invoice } = await seedJobInvoice(owner, 9000);
    const second = await createInvoice(owner, {
      title: "Exterior refresh balance",
      jobId: job.id,
      amount: 6000,
      dueAt: new Date().toISOString(),
    });
    await addPayment(owner, invoice.id, 9000);
    await addPayment(owner, second.id, 6000);

    const summary = await getSummary(
      owner,
      `?from=${dayOffset(-10)}&to=${dayOffset(0)}`,
    );

    expect(summary.revenue).toBe(15000);
    // Job line-item cost is 6000; two fully paid invoices must release it once.
    const allocatedCost = summary.serviceMargins.reduce(
      (sum, row) => sum + row.cost,
      0,
    );
    expect(allocatedCost).toBe(6000);
    expect(summary.grossProfit).toBe(15000 - 6000);

    expect(
      summary.serviceMargins.find((row) => row.category === "Windows"),
    ).toMatchObject({ revenue: 10000, cost: 4000, margin: 6000 });
    expect(
      summary.serviceMargins.find((row) => row.category === "Gutters"),
    ).toMatchObject({ revenue: 5000, cost: 2000, margin: 3000 });
    expect(summary.technicianRevenue[0]).toMatchObject({
      revenue: 15000,
      margin: 9000,
    });
  });

  it("nets refunds and never produces NaN margins", async () => {
    const customer = await createCustomer(owner, "Refund Client");
    const location = await createLocation(owner, customer.id);
    const job = await createJob(owner, {
      title: "Refund visit",
      customerId: customer.id,
      locationId: location.id,
    });
    const invoice = await createInvoice(owner, {
      title: "Refund visit",
      jobId: job.id,
      amount: 5000,
      dueAt: null,
    });
    await addPayment(owner, invoice.id, 5000);
    await addPayment(owner, invoice.id, -1500, { method: "ADJUSTMENT" });

    const summary = await getSummary(owner);

    expect(summary.revenue).toBe(3500);
    expect(summary.collected).toBe(5000);
    expect(summary.refunds).toBe(1500);
    expect(summary.grossProfit).toBe(3500);
    expect(summary.averageTicket).toBe(3500);
    expect(summary.outstanding).toBe(1500);
    expect(summary.overdueAmount).toBe(0);
    expect(summary.serviceMargins).toEqual([]);
    expect(summary.topCustomers[0]).toMatchObject({
      revenue: 3500,
      jobs: 1,
      balance: 1500,
    });

    const empty = await getSummary(owner, "?from=2020-01-01&to=2020-01-10");
    expect(empty.revenue).toBe(0);
    expect(empty.paymentCount).toBe(0);
    expect(empty.averageTicket).toBe(0);
    expect(empty.grossProfit).toBe(0);
    expect(empty.grossMarginPct).toBeNull();
    expect(
      empty.monthly.every((row) => row.revenue === 0 && row.expenses === 0),
    ).toBe(true);
  });

  it("keeps tenant data isolated", async () => {
    const { invoice } = await seedJobInvoice(owner, 15000);
    await addPayment(owner, invoice.id, 10000);
    const ownerExpense = await createExpense(owner, { amount: 2500 });
    expect(ownerExpense.statusCode).toBe(201);
    const ownerExpenseBody = ownerExpense.json() as { id: string };
    const expenseId = ownerExpenseBody.id;

    const other = await registerAccount(app, {
      email: `other-${crypto.randomUUID()}@example.com`,
    });

    const otherSummary = await getSummary(other);
    expect(otherSummary.revenue).toBe(0);
    expect(otherSummary.invoiced).toBe(0);
    expect(otherSummary.expenses).toBe(0);
    expect(otherSummary.outstanding).toBe(0);
    expect(otherSummary.topCustomers).toEqual([]);

    const payments = await app.inject({
      method: "GET",
      url: "/api/v1/finance/payments",
      headers: as(other),
    });
    expect(payments.statusCode).toBe(200);
    expect(payments.json().data).toEqual([]);

    const expenses = await app.inject({
      method: "GET",
      url: "/api/v1/finance/expenses",
      headers: as(other),
    });
    expect(expenses.statusCode).toBe(200);
    expect(expenses.json().data).toEqual([]);

    const patchForeign = await app.inject({
      method: "PATCH",
      url: `/api/v1/finance/expenses/${expenseId}`,
      headers: as(other),
      payload: { amount: 1 },
    });
    expect(patchForeign.statusCode).toBe(404);

    const deleteForeign = await app.inject({
      method: "DELETE",
      url: `/api/v1/finance/expenses/${expenseId}`,
      headers: as(other),
    });
    expect(deleteForeign.statusCode).toBe(404);

    const listForOwner = await app.inject({
      method: "GET",
      url: "/api/v1/finance/expenses",
      headers: as(owner),
    });
    expect(listForOwner.json().data).toHaveLength(1);
  });
});

describe("finance aging", () => {
  it("buckets balances on day boundaries and counts distinct customers", async () => {
    const { job } = await seedAgingJob(owner, "Boundary Co");
    const second = await seedAgingJob(owner, "Boundary Co Two");
    const amounts = [
      { days: 0, jobId: job.id },
      { days: -1, jobId: job.id },
      { days: -30, jobId: job.id },
      { days: -31, jobId: second.job.id },
      { days: -60, jobId: job.id },
      { days: -61, jobId: job.id },
      { days: -90, jobId: job.id },
      { days: -91, jobId: job.id },
    ];

    for (const [index, entry] of amounts.entries()) {
      await createInvoice(owner, {
        title: `Boundary ${index}`,
        jobId: entry.jobId,
        amount: 1000,
        dueAt: dayOffset(entry.days),
      });
    }

    const aging = await getAging(owner);
    expect(aging.buckets.map((bucket) => bucket.key)).toEqual([
      "CURRENT",
      "D1_30",
      "D31_60",
      "D61_90",
      "D90_PLUS",
    ]);
    expect(aging.buckets.map((bucket) => bucket.invoiceCount)).toEqual([
      1, 2, 2, 2, 1,
    ]);
    expect(aging.buckets.map((bucket) => bucket.customerCount)).toEqual([
      1, 1, 2, 1, 1,
    ]);
    expect(aging.buckets.map((bucket) => bucket.balance)).toEqual([
      1000, 2000, 2000, 2000, 1000,
    ]);
    expect(aging.totalInvoices).toBe(8);
    expect(aging.totalBalance).toBe(8000);
    expect(aging.buckets.reduce((sum, bucket) => sum + bucket.balance, 0)).toBe(
      aging.totalBalance,
    );
    expect(aging.oldestDueAt).not.toBeNull();
    expect(aging.oldestDueAt?.slice(0, 10)).toBe(dayOffset(-91));
  });

  it("treats a null due date as current", async () => {
    const { job } = await seedAgingJob(owner, "No Due Co");
    await createInvoice(owner, {
      title: "No due date",
      jobId: job.id,
      amount: 2500,
      dueAt: null,
    });

    const aging = await getAging(owner);
    const current = aging.buckets.find((bucket) => bucket.key === "CURRENT");
    expect(current?.invoiceCount).toBe(1);
    expect(current?.customerCount).toBe(1);
    expect(current?.balance).toBe(2500);
    expect(aging.totalInvoices).toBe(1);
    expect(aging.totalBalance).toBe(2500);
    expect(aging.oldestDueAt).toBeNull();
  });

  it("excludes fully paid, draft and void invoices", async () => {
    const { job } = await seedAgingJob(owner, "Exclusion Co");
    const paid = await createInvoice(owner, {
      title: "Paid",
      jobId: job.id,
      amount: 5000,
      dueAt: dayOffset(-5),
    });
    await addPayment(owner, paid.id, 5000);
    await createInvoice(owner, {
      title: "Draft",
      jobId: job.id,
      amount: 3000,
      status: "DRAFT",
      dueAt: dayOffset(-5),
    });
    await createInvoice(owner, {
      title: "Void",
      jobId: job.id,
      amount: 4000,
      status: "VOID",
      dueAt: dayOffset(-5),
    });
    const partial = await createInvoice(owner, {
      title: "Partially paid",
      jobId: job.id,
      amount: 8000,
      dueAt: dayOffset(-10),
    });
    await addPayment(owner, partial.id, 3000);

    const aging = await getAging(owner);
    const d1to30 = aging.buckets.find((bucket) => bucket.key === "D1_30");
    expect(d1to30?.invoiceCount).toBe(1);
    expect(d1to30?.balance).toBe(5000);
    expect(aging.totalInvoices).toBe(1);
    expect(aging.totalBalance).toBe(5000);
  });

  it("keeps tenant data isolated", async () => {
    const { job } = await seedAgingJob(owner, "Tenant Co");
    await createInvoice(owner, {
      title: "Owner invoice",
      jobId: job.id,
      amount: 6000,
      dueAt: dayOffset(-5),
    });

    const other = await registerAccount(app, {
      email: `aging-other-${crypto.randomUUID()}@example.com`,
    });

    const otherAging = await getAging(other);
    expect(otherAging.totalInvoices).toBe(0);
    expect(otherAging.totalBalance).toBe(0);
    expect(otherAging.oldestDueAt).toBeNull();
    expect(
      otherAging.buckets.every(
        (bucket) =>
          bucket.invoiceCount === 0 &&
          bucket.customerCount === 0 &&
          bucket.balance === 0,
      ),
    ).toBe(true);

    const ownerAging = await getAging(owner);
    expect(ownerAging.totalInvoices).toBe(1);
    expect(ownerAging.totalBalance).toBe(6000);
  });
});

describe("finance expenses", () => {
  it("restricts mutations to admins and audits them", async () => {
    const { job } = await seedJobInvoice(owner, 15000);

    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/workspace/invites",
      headers: as(owner),
      payload: { email: "finance-member@example.com", role: "MEMBER" },
    });
    expect(invite.statusCode).toBe(201);
    const token = invite.json().token as string;

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/auth/accept-invite",
      payload: { token, name: "Finance Member", password: "MemberPassword123" },
    });
    expect(accepted.statusCode).toBe(201);
    const member: TestAccount = {
      accessToken: accepted.json().accessToken as string,
      userId: accepted.json().user.id as string,
      workspaceId: accepted.json().workspace.id as string,
      email: "finance-member@example.com",
    };

    expect((await getSummary(member)).revenue).toBe(0);
    const memberList = await app.inject({
      method: "GET",
      url: "/api/v1/finance/expenses",
      headers: as(member),
    });
    expect(memberList.statusCode).toBe(200);

    const memberCreate = await createExpense(member);
    expect(memberCreate.statusCode).toBe(403);

    const created = await createExpense(owner, {
      category: "FUEL",
      vendor: "Shell",
      description: "Van fuel",
      amount: 4200,
      jobId: job.id,
      userId: owner.userId,
    });
    expect(created.statusCode).toBe(201);
    const expense = created.json() as {
      id: string;
      jobId: string;
      jobNumber: string;
      user: { id: string };
      category: string;
      amount: number;
    };
    expect(expense).toMatchObject({
      jobId: job.id,
      jobNumber: job.number,
      category: "FUEL",
      amount: 4200,
    });
    expect(expense.user.id).toBe(owner.userId);

    const memberPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/finance/expenses/${expense.id}`,
      headers: as(member),
      payload: { amount: 1 },
    });
    expect(memberPatch.statusCode).toBe(403);

    const memberDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/finance/expenses/${expense.id}`,
      headers: as(member),
    });
    expect(memberDelete.statusCode).toBe(403);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/finance/expenses/${expense.id}`,
      headers: as(owner),
      payload: { amount: 5000, category: "OTHER", vendor: null },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      amount: 5000,
      category: "OTHER",
      vendor: null,
    });

    const audits = await prisma.auditLog.findMany({
      where: { workspaceId: owner.workspaceId, entityType: "expense" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((entry) => entry.action).sort()).toEqual([
      "expense.created",
      "expense.updated",
    ]);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/finance/expenses/${expense.id}`,
      headers: as(owner),
    });
    expect(removed.statusCode).toBe(204);

    const remaining = await prisma.expense.count({
      where: { workspaceId: owner.workspaceId },
    });
    expect(remaining).toBe(0);
    const deleteAudit = await prisma.auditLog.findFirst({
      where: { workspaceId: owner.workspaceId, action: "expense.deleted" },
    });
    expect(deleteAudit).not.toBeNull();
  });

  it("validates references and paginates filtered expenses", async () => {
    const { job } = await seedJobInvoice(owner, 15000);

    const other = await registerAccount(app, {
      email: `foreign-${crypto.randomUUID()}@example.com`,
    });
    const foreignCustomer = await createCustomer(other, "Foreign Client");
    const foreignLocation = await createLocation(other, foreignCustomer.id);
    const foreignJob = await createJob(other, {
      title: "Foreign job",
      customerId: foreignCustomer.id,
      locationId: foreignLocation.id,
    });

    const foreignJobExpense = await createExpense(owner, {
      jobId: foreignJob.id,
    });
    expect(foreignJobExpense.statusCode).toBe(404);

    const foreignUserExpense = await createExpense(owner, {
      userId: other.userId,
    });
    expect(foreignUserExpense.statusCode).toBe(400);

    for (const description of ["Van wrap", "Flyers", "Gloves"]) {
      const response = await createExpense(owner, {
        category: "MARKETING",
        description,
        amount: 1000,
        jobId: job.id,
      });
      expect(response.statusCode).toBe(201);
    }
    const supplies = await createExpense(owner, {
      category: "SUPPLIES",
      description: "Soap",
      amount: 700,
    });
    expect(supplies.statusCode).toBe(201);

    const filtered = await app.inject({
      method: "GET",
      url: "/api/v1/finance/expenses?category=MARKETING&page=1&pageSize=2&sort=amount&order=asc",
      headers: as(owner),
    });
    expect(filtered.statusCode).toBe(200);
    const body = filtered.json() as {
      data: Array<{ category: string; amount: number }>;
      meta: {
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      };
    };
    expect(body.meta).toEqual({
      total: 3,
      page: 1,
      pageSize: 2,
      totalPages: 2,
    });
    expect(body.data).toHaveLength(2);
    expect(body.data.every((row) => row.category === "MARKETING")).toBe(true);

    const byJob = await app.inject({
      method: "GET",
      url: `/api/v1/finance/expenses?jobId=${job.id}`,
      headers: as(owner),
    });
    expect(byJob.json().meta.total).toBe(3);

    const byDate = await app.inject({
      method: "GET",
      url: `/api/v1/finance/expenses?from=${dayOffset(-1)}&to=${dayOffset(0)}`,
      headers: as(owner),
    });
    expect(byDate.json().meta.total).toBe(4);

    const payments = await app.inject({
      method: "GET",
      url: "/api/v1/finance/payments",
      headers: as(owner),
    });
    expect(payments.statusCode).toBe(200);
    expect(payments.json().data).toEqual([]);
  });
});
