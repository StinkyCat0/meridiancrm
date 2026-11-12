import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
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

function as(target: TestAccount = owner): Record<string, string> {
  return authHeaders(target);
}

function getCsv(path: string, target: TestAccount = owner) {
  return app.inject({
    method: "GET",
    url: `/api/v1${path}`,
    headers: as(target),
  });
}

/** Small RFC 4180 reader so assertions can inspect individual cells. */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (csv[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && csv[index + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index += 1;
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function dataRows(response: { body: string }): string[][] {
  return parseCsv(response.body).slice(1);
}

async function createCustomer(
  target: TestAccount,
  payload: {
    name: string;
    customerType?: string;
    industry?: string;
    email?: string;
    phone?: string;
    address?: string;
    tags?: string[];
  },
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/companies",
    headers: as(target),
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json() as {
    id: string;
    name: string;
    customerType: string;
  };
}

async function createInvoice(
  target: TestAccount,
  payload: {
    title: string;
    customerId: string;
    amount?: number;
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
      amount: 10000,
      status: "SENT",
      issuedAt: new Date().toISOString(),
      ...payload,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; number: string };
}

async function addPayment(
  target: TestAccount,
  invoiceId: string,
  amount: number,
  options: {
    method?: string;
    reference?: string;
    receivedAt?: Date;
  } = {},
) {
  return prisma.payment.create({
    data: {
      workspaceId: target.workspaceId,
      invoiceId,
      amount,
      method: options.method ?? "CARD",
      reference: options.reference ?? null,
      receivedAt: options.receivedAt ?? new Date(),
      recordedById: target.userId,
    },
  });
}

async function createExpense(
  target: TestAccount,
  payload: {
    category: string;
    description: string;
    amount: number;
    vendor?: string | null;
    incurredAt?: string | null;
  },
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/finance/expenses",
    headers: as(target),
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

describe("CSV export responses", () => {
  it("serves attachment headers, CRLF rows and the documented columns", async () => {
    await createCustomer(owner, { name: "Cedar & Co" });
    const stamp = new Date().toISOString().slice(0, 10);

    const cases = [
      {
        path: "/exports/invoices.csv",
        kind: "invoices",
        header:
          "number,status,title,customer,location,issuedAt,dueAt,amount,amountPaid,balance,overdue",
      },
      {
        path: "/exports/payments.csv",
        kind: "payments",
        header:
          "receivedAt,invoiceNumber,customer,amount,method,reference,recordedBy",
      },
      {
        path: "/exports/expenses.csv",
        kind: "expenses",
        header: "incurredAt,category,vendor,description,amount,jobNumber,user",
      },
      {
        path: "/exports/customers.csv",
        kind: "customers",
        header: "name,type,vertical,email,phone,address,tags,openJobs,archived",
      },
    ] as const;

    for (const entry of cases) {
      const response = await getCsv(entry.path);
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
      expect(response.headers["content-disposition"]).toBe(
        `attachment; filename=${entry.kind}-${stamp}.csv`,
      );
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body.startsWith(`${entry.header}\r\n`)).toBe(true);
      expect(response.body.replaceAll("\r\n", "")).not.toContain("\n");
    }
  });

  it("requires authentication for every export", async () => {
    for (const path of [
      "/exports/invoices.csv",
      "/exports/payments.csv",
      "/exports/expenses.csv",
      "/exports/customers.csv",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1${path}`,
      });
      expect(response.statusCode).toBe(401);
    }
  });
});

describe("CSV safety", () => {
  it("escapes formula-leading cells and quotes delimited values", async () => {
    const customer = await createCustomer(owner, {
      name: '@Cedar, "VIP"',
    });
    await createInvoice(owner, {
      customerId: customer.id,
      title: "=SUM(A1:A2)",
    });
    await createInvoice(owner, {
      customerId: customer.id,
      title: "+cmd|' /C calc'!A0",
    });
    await createInvoice(owner, {
      customerId: customer.id,
      title: "-1+1",
    });

    const response = await getCsv("/exports/invoices.csv");
    expect(response.statusCode).toBe(200);
    const rows = dataRows(response);
    const titles = rows.map((row) => row[2]);

    expect(titles).toEqual(
      expect.arrayContaining(["'=SUM(A1:A2)", "'+cmd|' /C calc'!A0", "'-1+1"]),
    );
    for (const row of rows) {
      expect(row[3]).toBe(`'@Cedar, "VIP"`);
    }
  });

  it("escapes leading tabs and carriage returns in user-controlled cells", async () => {
    await prisma.company.create({
      data: { workspaceId: owner.workspaceId, name: "\tTabbed customer" },
    });
    await prisma.company.create({
      data: { workspaceId: owner.workspaceId, name: "\rReturn customer" },
    });

    const response = await getCsv("/exports/customers.csv");
    expect(response.statusCode).toBe(200);
    const names = dataRows(response).map((row) => row[0]);

    expect(names).toContain("'\tTabbed customer");
    expect(names).toContain("'\rReturn customer");
  });

  it("formats cents with two decimals and no currency symbol", async () => {
    const customer = await createCustomer(owner, { name: "Money Co" });
    const invoice = await createInvoice(owner, {
      customerId: customer.id,
      title: "Money formatting",
      amount: 123456,
    });
    await addPayment(owner, invoice.id, 2500, {
      receivedAt: new Date("2026-02-01T12:00:00Z"),
    });
    await createExpense(owner, {
      category: "SUPPLIES",
      description: "Towels",
      amount: 4321,
      incurredAt: "2026-02-02T00:00:00.000Z",
    });

    const invoices = dataRows(await getCsv("/exports/invoices.csv"));
    expect(invoices[0]).toEqual(
      expect.arrayContaining(["1234.56", "0.00", "1234.56"]),
    );

    const payments = dataRows(await getCsv("/exports/payments.csv"));
    expect(payments[0]?.[3]).toBe("25.00");

    const expenses = dataRows(await getCsv("/exports/expenses.csv"));
    expect(expenses[0]?.[4]).toBe("43.21");
  });
});

describe("CSV tenant isolation", () => {
  it("only exports rows from the authenticated workspace", async () => {
    const other = await registerAccount(app, {
      workspaceName: "Other Workspace",
    });

    const ownCustomer = await createCustomer(owner, { name: "Owner Customer" });
    const ownInvoice = await createInvoice(owner, {
      customerId: ownCustomer.id,
      title: "Owner invoice",
    });
    await addPayment(owner, ownInvoice.id, 1000);
    await createExpense(owner, {
      category: "SUPPLIES",
      description: "Owner supplies",
      amount: 900,
    });

    const otherCustomer = await createCustomer(other, {
      name: "Other Customer",
    });
    const otherInvoice = await createInvoice(other, {
      customerId: otherCustomer.id,
      title: "Other invoice",
    });
    await addPayment(other, otherInvoice.id, 2000);
    await createExpense(other, {
      category: "SUPPLIES",
      description: "Other supplies",
      amount: 800,
    });

    const invoices = (await getCsv("/exports/invoices.csv")).body;
    expect(invoices).toContain("Owner invoice");
    expect(invoices).not.toContain("Other invoice");

    const payments = (await getCsv("/exports/payments.csv")).body;
    expect(payments).toContain("Owner Customer");
    expect(payments).not.toContain("Other Customer");

    const expenses = (await getCsv("/exports/expenses.csv")).body;
    expect(expenses).toContain("Owner supplies");
    expect(expenses).not.toContain("Other supplies");

    const customers = (await getCsv("/exports/customers.csv")).body;
    expect(customers).toContain("Owner Customer");
    expect(customers).not.toContain("Other Customer");

    const otherCustomers = (await getCsv("/exports/customers.csv", other)).body;
    expect(otherCustomers).toContain("Other Customer");
    expect(otherCustomers).not.toContain("Owner Customer");
  });
});

describe("CSV filters", () => {
  it("filters invoices by status, customer, search and overdue", async () => {
    const alpha = await createCustomer(owner, { name: "Alpha Co" });
    const beta = await createCustomer(owner, { name: "Beta Co" });
    const sent = await createInvoice(owner, {
      customerId: alpha.id,
      title: "Gutter repair",
      status: "SENT",
      amount: 10000,
      dueAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    const paid = await createInvoice(owner, {
      customerId: beta.id,
      title: "Window clean",
      status: "PAID",
      amount: 20000,
      dueAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    });

    const byStatus = dataRows(
      await getCsv("/exports/invoices.csv?status=SENT"),
    );
    expect(byStatus).toHaveLength(1);
    expect(byStatus[0]?.[0]).toBe(sent.number);

    const byCustomer = dataRows(
      await getCsv(`/exports/invoices.csv?customerId=${beta.id}`),
    );
    expect(byCustomer).toHaveLength(1);
    expect(byCustomer[0]?.[0]).toBe(paid.number);

    const bySearch = dataRows(await getCsv("/exports/invoices.csv?q=Gutter"));
    expect(bySearch).toHaveLength(1);
    expect(bySearch[0]?.[0]).toBe(sent.number);

    const overdue = dataRows(
      await getCsv("/exports/invoices.csv?overdue=true"),
    );
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.[0]).toBe(sent.number);

    const paidOverdue = await getCsv(
      "/exports/invoices.csv?status=PAID&overdue=true",
    );
    expect(dataRows(paidOverdue)).toHaveLength(0);

    const invalid = await getCsv("/exports/invoices.csv?status=NOPE");
    expect(invalid.statusCode).toBe(400);
  });

  it("filters payments by date range, customer and search", async () => {
    const alpha = await createCustomer(owner, { name: "Alpha Co" });
    const beta = await createCustomer(owner, { name: "Beta Co" });
    const alphaInvoice = await createInvoice(owner, {
      customerId: alpha.id,
      title: "Alpha work",
    });
    const betaInvoice = await createInvoice(owner, {
      customerId: beta.id,
      title: "Beta work",
    });
    await addPayment(owner, alphaInvoice.id, 2500, {
      method: "CHECK",
      reference: "check-100",
      receivedAt: new Date("2026-01-10T12:00:00Z"),
    });
    await addPayment(owner, betaInvoice.id, 5000, {
      method: "ACH",
      reference: "ach-200",
      receivedAt: new Date("2026-03-10T12:00:00Z"),
    });

    const march = dataRows(
      await getCsv("/exports/payments.csv?from=2026-03-01&to=2026-03-31"),
    );
    expect(march).toHaveLength(1);
    expect(march[0]?.[1]).toBe(betaInvoice.number);
    expect(march[0]?.[3]).toBe("50.00");

    const byCustomer = dataRows(
      await getCsv(`/exports/payments.csv?customerId=${alpha.id}`),
    );
    expect(byCustomer).toHaveLength(1);
    expect(byCustomer[0]?.[1]).toBe(alphaInvoice.number);

    const byReference = dataRows(
      await getCsv("/exports/payments.csv?q=check-100"),
    );
    expect(byReference).toHaveLength(1);
    expect(byReference[0]?.[5]).toBe("check-100");
  });

  it("filters expenses by category, date range and search", async () => {
    await createExpense(owner, {
      category: "FUEL",
      vendor: "Shell",
      description: "Van fuel",
      amount: 4321,
      incurredAt: "2026-01-05T00:00:00.000Z",
    });
    await createExpense(owner, {
      category: "SUPPLIES",
      vendor: "Uline",
      description: "Gloves",
      amount: 1500,
      incurredAt: "2026-04-02T00:00:00.000Z",
    });

    const fuel = dataRows(await getCsv("/exports/expenses.csv?category=FUEL"));
    expect(fuel).toHaveLength(1);
    expect(fuel[0]?.[2]).toBe("Shell");
    expect(fuel[0]?.[4]).toBe("43.21");

    const april = dataRows(
      await getCsv("/exports/expenses.csv?from=2026-04-01&to=2026-04-30"),
    );
    expect(april).toHaveLength(1);
    expect(april[0]?.[3]).toBe("Gloves");

    const bySearch = dataRows(await getCsv("/exports/expenses.csv?q=Gloves"));
    expect(bySearch).toHaveLength(1);
    expect(bySearch[0]?.[2]).toBe("Uline");
  });

  it("filters customers by archive, industry, type and search", async () => {
    const hvac = await createCustomer(owner, {
      name: "Acme HVAC",
      customerType: "COMMERCIAL",
      industry: "HVAC",
    });
    const residential = await createCustomer(owner, {
      name: "Bright Home",
      customerType: "RESIDENTIAL",
      industry: "Cleaning",
    });

    const archived = await app.inject({
      method: "DELETE",
      url: `/api/v1/companies/${residential.id}`,
      headers: as(owner),
    });
    expect(archived.statusCode).toBe(204);

    const active = dataRows(await getCsv("/exports/customers.csv"));
    expect(active).toHaveLength(1);
    expect(active[0]?.[0]).toBe(hvac.name);

    const archivedRows = dataRows(
      await getCsv("/exports/customers.csv?archive=archived"),
    );
    expect(archivedRows).toHaveLength(1);
    expect(archivedRows[0]?.[0]).toBe(residential.name);

    const byIndustry = dataRows(
      await getCsv("/exports/customers.csv?industry=HVAC"),
    );
    expect(byIndustry).toHaveLength(1);
    expect(byIndustry[0]?.[0]).toBe(hvac.name);

    const byType = dataRows(
      await getCsv(
        "/exports/customers.csv?archive=all&customerType=RESIDENTIAL",
      ),
    );
    expect(byType).toHaveLength(1);
    expect(byType[0]?.[0]).toBe(residential.name);

    const bySearch = dataRows(await getCsv("/exports/customers.csv?q=Acme"));
    expect(bySearch).toHaveLength(1);
    expect(bySearch[0]?.[0]).toBe(hvac.name);
  });
});
