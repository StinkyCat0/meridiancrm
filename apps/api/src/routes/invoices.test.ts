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
let account: TestAccount;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  account = await registerAccount(app);
});

function asAccount() {
  return authHeaders(account);
}

async function createCustomer(name = "Cedar & Co") {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/companies",
    headers: asAccount(),
    payload: {
      name,
      customerType: "RESIDENTIAL",
      email: `${name.toLowerCase().replace(/[^a-z]+/g, "")}@example.com`,
      phone: "503-555-0100",
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

async function createInvoice(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/v1/invoices",
    headers: asAccount(),
    payload,
  });
}

async function getInvoice(id: string) {
  return app.inject({
    method: "GET",
    url: `/api/v1/invoices/${id}`,
    headers: asAccount(),
  });
}

async function getPayments(id: string) {
  return app.inject({
    method: "GET",
    url: `/api/v1/invoices/${id}/payments`,
    headers: asAccount(),
  });
}

describe("invoice money invariants", () => {
  it("rejects money mutations on a void invoice without recording a payment", async () => {
    const customer = await createCustomer();
    const invoice = (
      await createInvoice({
        title: "Void guard",
        customerId: customer.id,
        amount: 10000,
        status: "SENT",
      })
    ).json();

    const voided = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
      payload: { status: "VOID" },
    });
    expect(voided.statusCode).toBe(200);
    expect(voided.json().status).toBe("VOID");

    const mutated = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
      payload: { amountPaid: 5000 },
    });
    expect(mutated.statusCode).toBe(409);

    const fetched = await getInvoice(invoice.id);
    expect(fetched.json()).toMatchObject({
      status: "VOID",
      amountPaid: 0,
      balance: 10000,
    });

    const ledger = await getPayments(invoice.id);
    expect(ledger.json()).toHaveLength(0);
  });

  it("rejects an explicit SENT status once the money settles the invoice", async () => {
    const customer = await createCustomer();
    const invoice = (
      await createInvoice({
        title: "Status must match money",
        customerId: customer.id,
        amount: 10000,
        status: "SENT",
      })
    ).json();

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
      payload: { amountPaid: 10000, status: "SENT" },
    });
    expect(patched.statusCode).toBe(400);

    const fetched = await getInvoice(invoice.id);
    expect(fetched.json()).toMatchObject({ status: "SENT", amountPaid: 0 });

    const ledger = await getPayments(invoice.id);
    expect(ledger.json()).toHaveLength(0);
  });

  it("derives PAID when a patch settles the full amount without a status", async () => {
    const customer = await createCustomer();
    const invoice = (
      await createInvoice({
        title: "Implicit paid",
        customerId: customer.id,
        amount: 10000,
        status: "SENT",
      })
    ).json();

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
      payload: { amountPaid: 10000 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      status: "PAID",
      amountPaid: 10000,
      balance: 0,
    });
    expect(patched.json().paidAt).not.toBeNull();

    const ledger = await getPayments(invoice.id);
    expect(ledger.json()).toHaveLength(1);
    expect(ledger.json()[0]).toMatchObject({ amount: 10000 });
  });

  it("rejects PARTIAL when creating an invoice", async () => {
    const customer = await createCustomer();
    const rejected = await createInvoice({
      title: "Cannot start partial",
      customerId: customer.id,
      amount: 10000,
      status: "PARTIAL",
    });
    expect(rejected.statusCode).toBe(400);
  });
});
