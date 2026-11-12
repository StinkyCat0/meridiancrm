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

function asAccount(target: TestAccount = account) {
  return authHeaders(target);
}

async function createCustomer(
  name = "Cedar & Co",
  extra: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/companies",
    headers: asAccount(),
    payload: {
      name,
      customerType: "RESIDENTIAL",
      email: `${name.toLowerCase().replace(/[^a-z]+/g, "")}@example.com`,
      phone: "503-555-0100",
      industry: "Cleaning",
      ...extra,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function createLocation(
  customerId: string,
  payload: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/locations",
    headers: asAccount(),
    payload: {
      customerId,
      label: "Main",
      line1: "412 Alder Street",
      city: "Portland",
      state: "OR",
      postalCode: "97205",
      ...payload,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function createService(payload: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/services",
    headers: asAccount(),
    payload: {
      name: "Full interior window clean",
      category: "Windows",
      unit: "VISIT",
      durationMinutes: 120,
      price: 15000,
      taxable: true,
      ...payload,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function createJob(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/v1/jobs",
    headers: asAccount(),
    payload,
  });
}

describe("service locations", () => {
  it("keeps one primary location per customer and counts open jobs", async () => {
    const customer = await createCustomer();
    const first = await createLocation(customer.id, { isPrimary: true });
    expect(first.isPrimary).toBe(true);
    expect(first.customer.name).toBe(customer.name);

    const second = await createLocation(customer.id, {
      label: "Boat house",
      isPrimary: true,
    });
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/locations?customerId=${customer.id}`,
      headers: asAccount(),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(2);
    const primaries = list
      .json()
      .data.filter((row: { isPrimary: boolean }) => row.isPrimary);
    expect(primaries.map((row: { id: string }) => row.id)).toEqual([second.id]);

    await createJob({
      title: "Window wash",
      customerId: customer.id,
      locationId: first.id,
    });
    const refreshed = await app.inject({
      method: "GET",
      url: `/api/v1/locations/${first.id}`,
      headers: asAccount(),
    });
    expect(refreshed.json().openJobCount).toBe(1);

    const company = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${customer.id}`,
      headers: asAccount(),
    });
    expect(company.json().locationCount).toBe(2);
  });

  it("archives and restores a location, and blocks permanent delete with history", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const archived = await app.inject({
      method: "DELETE",
      url: `/api/v1/locations/${location.id}`,
      headers: asAccount(),
    });
    expect(archived.statusCode).toBe(204);

    const active = await app.inject({
      method: "GET",
      url: "/api/v1/locations",
      headers: asAccount(),
    });
    expect(active.json().data).toHaveLength(0);

    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/locations/${location.id}/restore`,
      headers: asAccount(),
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().archived).toBe(false);

    await createJob({
      title: "Recurring clean",
      customerId: customer.id,
      locationId: location.id,
    });
    const denied = await app.inject({
      method: "DELETE",
      url: `/api/v1/locations/${location.id}?permanent=true`,
      headers: asAccount(),
    });
    expect(denied.statusCode).toBe(400);
  });
});

describe("service price book", () => {
  it("creates, filters, archives and restores services", async () => {
    const windows = await createService();
    await createService({
      name: "Deep clean",
      category: "Cleaning",
      price: 24000,
      unit: "HOUR",
    });

    const filtered = await app.inject({
      method: "GET",
      url: "/api/v1/services?category=Windows",
      headers: asAccount(),
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().data).toHaveLength(1);
    expect(filtered.json().data[0].id).toBe(windows.id);
    expect(filtered.json().data[0].price).toBe(15000);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/services/${windows.id}`,
      headers: asAccount(),
      payload: { price: 16500, durationMinutes: 90 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ price: 16500, durationMinutes: 90 });

    const archived = await app.inject({
      method: "DELETE",
      url: `/api/v1/services/${windows.id}`,
      headers: asAccount(),
    });
    expect(archived.statusCode).toBe(204);
    const active = await app.inject({
      method: "GET",
      url: "/api/v1/services",
      headers: asAccount(),
    });
    expect(active.json().data).toHaveLength(1);

    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/services/${windows.id}/restore`,
      headers: asAccount(),
    });
    expect(restored.json().archived).toBe(false);
  });
});

describe("jobs", () => {
  it("prices line items, applies tax and allocates sequential numbers", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const service = await createService();

    const first = await createJob({
      title: "Quarterly window clean",
      customerId: customer.id,
      locationId: location.id,
      taxRate: 8.25,
      lineItems: [
        {
          serviceId: service.id,
          name: service.name,
          quantity: 2,
          unitPrice: service.price,
        },
        { name: "Supply fee", quantity: 1, unitPrice: 2500 },
      ],
    });
    expect(first.statusCode).toBe(201);
    const job = first.json();
    expect(job.number).toBe("JOB-1001");
    expect(job.subtotal).toBe(32500);
    expect(job.tax).toBe(2681);
    expect(job.total).toBe(35181);
    expect(job.taxRate).toBe(8.25);
    expect(job.status).toBe("UNSCHEDULED");
    expect(job.lineItems).toHaveLength(2);

    const second = await createJob({
      title: "Follow-up",
      customerId: customer.id,
      locationId: location.id,
    });
    expect(second.json().number).toBe("JOB-1002");
  });

  it("moves through the lifecycle with timestamps and an activity", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const created = await createJob({
      title: "Gutter clearing",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      scheduledStart: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const job = created.json();
    expect(job.scheduledEnd).not.toBeNull();

    const started = await app.inject({
      method: "PATCH",
      url: `/api/v1/jobs/${job.id}/status`,
      headers: asAccount(),
      payload: { status: "IN_PROGRESS" },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().arrivedAt).not.toBeNull();
    expect(started.json().completedAt).toBeNull();

    const completed = await app.inject({
      method: "PATCH",
      url: `/api/v1/jobs/${job.id}/status`,
      headers: asAccount(),
      payload: { status: "COMPLETED" },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().completedAt).not.toBeNull();

    const activities = await app.inject({
      method: "GET",
      url: "/api/v1/activities?type=NOTE",
      headers: asAccount(),
    });
    expect(activities.statusCode).toBe(200);
    expect(
      activities
        .json()
        .data.some((entry: { title: string }) =>
          entry.title.includes("Gutter clearing"),
        ),
    ).toBe(true);
  });

  it("duplicates a job into a new unscheduled work order", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const original = (
      await createJob({
        title: "Monthly deep clean",
        customerId: customer.id,
        locationId: location.id,
        recurrence: "MONTHLY",
        taxRate: 10,
        lineItems: [{ name: "Deep clean", quantity: 1, unitPrice: 20000 }],
      })
    ).json();

    const copyResponse = await app.inject({
      method: "POST",
      url: `/api/v1/jobs/${original.id}/duplicate`,
      headers: asAccount(),
      payload: {},
    });
    expect(copyResponse.statusCode).toBe(201);
    const copy = copyResponse.json();
    expect(copy.id).not.toBe(original.id);
    expect(copy.number).toBe("JOB-1002");
    expect(copy.status).toBe("UNSCHEDULED");
    expect(copy.recurrence).toBe("MONTHLY");
    expect(copy.total).toBe(original.total);
    expect(copy.lineItems).toHaveLength(1);
  });

  it("rejects line items that reference another workspace's service", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const other = await registerAccount(app, {
      email: `other-${crypto.randomUUID()}@example.com`,
    });
    const otherService = await app.inject({
      method: "POST",
      url: "/api/v1/services",
      headers: asAccount(other),
      payload: { name: "Private service", price: 5000 },
    });
    const foreignId = otherService.json().id;

    const response = await createJob({
      title: "Cross tenant",
      customerId: customer.id,
      locationId: location.id,
      lineItems: [
        {
          serviceId: foreignId,
          name: "Borrowed",
          quantity: 1,
          unitPrice: 5000,
        },
      ],
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("estimates", () => {
  it("requires a sent estimate before conversion, then creates a job", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/estimates",
      headers: asAccount(),
      payload: {
        title: "Spring refresh",
        customerId: customer.id,
        locationId: location.id,
        taxRate: 5,
        lineItems: [{ name: "Whole home wash", quantity: 1, unitPrice: 40000 }],
      },
    });
    expect(created.statusCode).toBe(201);
    const estimate = created.json();
    expect(estimate.number).toBe("EST-1001");
    expect(estimate.total).toBe(42000);
    expect(estimate.jobId).toBeNull();

    const tooEarly = await app.inject({
      method: "POST",
      url: `/api/v1/estimates/${estimate.id}/convert`,
      headers: asAccount(),
      payload: {},
    });
    expect(tooEarly.statusCode).toBe(400);

    const sent = await app.inject({
      method: "PATCH",
      url: `/api/v1/estimates/${estimate.id}/status`,
      headers: asAccount(),
      payload: { status: "SENT" },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().issuedAt).not.toBeNull();

    const converted = await app.inject({
      method: "POST",
      url: `/api/v1/estimates/${estimate.id}/convert`,
      headers: asAccount(),
      payload: {},
    });
    expect(converted.statusCode).toBe(201);
    const job = converted.json();
    expect(job.number).toBe("JOB-1001");
    expect(job.source).toBe("Estimate");
    expect(job.total).toBe(42000);

    const fetched = await app.inject({
      method: "GET",
      url: `/api/v1/estimates/${estimate.id}`,
      headers: asAccount(),
    });
    expect(fetched.json().status).toBe("APPROVED");
    expect(fetched.json().jobId).toBe(job.id);

    const again = await app.inject({
      method: "POST",
      url: `/api/v1/estimates/${estimate.id}/convert`,
      headers: asAccount(),
      payload: {},
    });
    expect(again.statusCode).toBe(409);
  });

  it("creates exactly one job when two converts race", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/estimates",
      headers: asAccount(),
      payload: {
        title: "Race",
        customerId: customer.id,
        locationId: location.id,
        status: "SENT",
        lineItems: [{ name: "Visit", quantity: 1, unitPrice: 10000 }],
      },
    });
    expect(created.statusCode).toBe(201);
    const estimate = created.json();

    const responses = await Promise.all(
      [0, 1].map(() =>
        app.inject({
          method: "POST",
          url: `/api/v1/estimates/${estimate.id}/convert`,
          headers: asAccount(),
          payload: {},
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);

    const jobs = await prisma.job.count({
      where: { workspaceId: account.workspaceId },
    });
    expect(jobs).toBe(1);
  });

  it("filters open estimates", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    for (const status of ["DRAFT", "SENT", "APPROVED"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/estimates",
        headers: asAccount(),
        payload: {
          title: `${status} quote`,
          customerId: customer.id,
          locationId: location.id,
          status,
        },
      });
      expect(response.statusCode).toBe(201);
    }
    const open = await app.inject({
      method: "GET",
      url: "/api/v1/estimates?open=true",
      headers: asAccount(),
    });
    expect(
      open
        .json()
        .data.map((row: { status: string }) => row.status)
        .sort(),
    ).toEqual(["DRAFT", "SENT"]);
  });
});

describe("invoices", () => {
  it("creates from a job, records partial and full payments, and flags overdue", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const job = (
      await createJob({
        title: "Post-construction clean",
        customerId: customer.id,
        locationId: location.id,
        lineItems: [{ name: "Clean", quantity: 1, unitPrice: 50000 }],
      })
    ).json();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: asAccount(),
      payload: {
        title: "Invoice for post-construction clean",
        jobId: job.id,
        status: "SENT",
        dueAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    });
    expect(created.statusCode).toBe(201);
    const invoice = created.json();
    expect(invoice.number).toBe("INV-1001");
    expect(invoice.amount).toBe(50000);
    expect(invoice.customer.id).toBe(customer.id);
    expect(invoice.jobId).toBe(job.id);
    expect(invoice.overdue).toBe(true);
    expect(invoice.balance).toBe(50000);

    const partial = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}/payment`,
      headers: asAccount(),
      payload: { amountPaid: 20000 },
    });
    expect(partial.statusCode).toBe(200);
    expect(partial.json()).toMatchObject({
      status: "PARTIAL",
      balance: 30000,
      overdue: true,
    });

    const overpay = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}/payment`,
      headers: asAccount(),
      payload: { amountPaid: 60000 },
    });
    expect(overpay.statusCode).toBe(400);

    const paid = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}/payment`,
      headers: asAccount(),
      payload: { amountPaid: 50000 },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({
      status: "PAID",
      balance: 0,
      overdue: false,
      amountPaid: 50000,
    });
    expect(paid.json().paidAt).not.toBeNull();

    const overdueList = await app.inject({
      method: "GET",
      url: "/api/v1/invoices?overdue=true",
      headers: asAccount(),
    });
    expect(overdueList.json().data).toHaveLength(0);
  });

  it("rejects an invoice with neither a job nor a customer", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: asAccount(),
      payload: { title: "Orphan" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("operations summary and search", () => {
  it("summarises the day, revenue, receivables and estimates", async () => {
    const customer = await createCustomer("Harbor Property Group", {
      customerType: "PROPERTY_MANAGER",
    });
    const location = await createLocation(customer.id);

    const scheduled = (
      await createJob({
        title: "Lobby glass",
        customerId: customer.id,
        locationId: location.id,
        status: "SCHEDULED",
        scheduledStart: new Date().toISOString(),
        lineItems: [{ name: "Lobby glass", quantity: 1, unitPrice: 30000 }],
      })
    ).json();
    await createJob({
      title: "Completed unit turn",
      customerId: customer.id,
      locationId: location.id,
      status: "COMPLETED",
      lineItems: [{ name: "Turn clean", quantity: 1, unitPrice: 12000 }],
    });
    await createJob({
      title: "Awaiting slot",
      customerId: customer.id,
      locationId: location.id,
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: asAccount(),
      payload: {
        title: "Lobby glass invoice",
        jobId: scheduled.id,
        status: "SENT",
        dueAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/estimates",
      headers: asAccount(),
      payload: {
        title: "Portfolio proposal",
        customerId: customer.id,
        locationId: location.id,
        status: "SENT",
        lineItems: [
          { name: "Monthly portfolio care", quantity: 1, unitPrice: 80000 },
        ],
      },
    });

    const summary = await app.inject({
      method: "GET",
      url: "/api/v1/ops/summary",
      headers: asAccount(),
    });
    expect(summary.statusCode).toBe(200);
    const body = summary.json();
    expect(body.jobsToday).toBe(1);
    expect(body.jobsTodayCompleted).toBe(1);
    expect(body.jobsUnscheduled).toBe(1);
    expect(body.revenueToday).toBe(12000);
    expect(body.outstanding).toBe(30000);
    expect(body.overdueInvoices).toBe(1);
    expect(body.openEstimates).toBe(1);
    expect(body.openEstimateValue).toBe(80000);
    expect(body.today[0].title).toBe("Lobby glass");

    const badDate = await app.inject({
      method: "GET",
      url: "/api/v1/ops/summary?date=2026-02-31",
      headers: asAccount(),
    });
    expect(badDate.statusCode).toBe(400);

    const search = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=Lobby",
      headers: asAccount(),
    });
    expect(search.statusCode).toBe(200);
    const hits = search.json().hits as Array<{ type: string }>;
    expect(hits.some((hit) => hit.type === "job")).toBe(true);
    expect(
      hits.some((hit) => hit.type === "invoice") ||
        hits.some((hit) => hit.type === "location"),
    ).toBe(true);
  });

  it("isolates service operations between workspaces", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const job = (
      await createJob({
        title: "Private job",
        customerId: customer.id,
        locationId: location.id,
      })
    ).json();

    const other = await registerAccount(app, {
      email: `other-${crypto.randomUUID()}@example.com`,
    });
    const hidden = await app.inject({
      method: "GET",
      url: `/api/v1/jobs/${job.id}`,
      headers: asAccount(other),
    });
    expect(hidden.statusCode).toBe(404);

    const hiddenLocation = await app.inject({
      method: "GET",
      url: `/api/v1/locations/${location.id}`,
      headers: asAccount(other),
    });
    expect(hiddenLocation.statusCode).toBe(404);
  });
});

describe("document numbering", () => {
  it("allocates unique numbers for concurrent creates and never reuses deleted ones", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);

    const responses = await Promise.all(
      ["A", "B", "C", "D"].map((suffix) =>
        createJob({
          title: `Concurrent ${suffix}`,
          customerId: customer.id,
          locationId: location.id,
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([
      201, 201, 201, 201,
    ]);
    const numbers = responses.map(
      (response) => (response.json() as { number: string }).number,
    );
    expect(new Set(numbers).size).toBe(4);
    for (const number of numbers) {
      expect(number).toMatch(/^JOB-10\d{2}$/);
    }
    const rows = await prisma.job.findMany({
      where: { workspaceId: account.workspaceId },
      select: { number: true },
    });
    expect(new Set(rows.map((row) => row.number)).size).toBe(4);

    const firstInvoice = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: asAccount(),
      payload: {
        title: "Sequence invoice",
        customerId: customer.id,
        amount: 1000,
        status: "SENT",
      },
    });
    expect(firstInvoice.json().number).toBe("INV-1001");
    const firstEstimate = await app.inject({
      method: "POST",
      url: "/api/v1/estimates",
      headers: asAccount(),
      payload: {
        title: "Sequence quote",
        customerId: customer.id,
        locationId: location.id,
      },
    });
    expect(firstEstimate.json().number).toBe("EST-1001");

    const doomed = (
      await createJob({
        title: "Doomed job",
        customerId: customer.id,
        locationId: location.id,
      })
    ).json();
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/jobs/${doomed.id}`,
      headers: asAccount(),
    });
    expect(removed.statusCode).toBe(204);
    const replacement = await createJob({
      title: "Replacement job",
      customerId: customer.id,
      locationId: location.id,
    });
    expect(replacement.statusCode).toBe(201);
    const replacementNumber = replacement.json().number as string;
    const finalRows = await prisma.job.findMany({
      where: { workspaceId: account.workspaceId },
      select: { number: true },
    });
    expect(replacementNumber).not.toBe(doomed.number);
    expect(finalRows.map((row) => row.number)).toContain(replacementNumber);
    expect(finalRows.map((row) => row.number)).not.toContain(doomed.number);
  });
});

describe("job lifecycle invariants", () => {
  it("rejects illegal transitions and lists the allowed statuses", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);

    const completed = (
      await createJob({
        title: "Completed on arrival",
        customerId: customer.id,
        locationId: location.id,
        status: "COMPLETED",
      })
    ).json();

    const rejected = await app.inject({
      method: "PATCH",
      url: `/api/v1/jobs/${completed.id}/status`,
      headers: asAccount(),
      payload: { status: "SCHEDULED" },
    });
    expect(rejected.statusCode).toBe(409);
    const details = rejected.json().error.details as { allowed: string[] };
    expect(details.allowed).toEqual(["COMPLETED"]);

    const canceled = (
      await createJob({
        title: "Canceled job",
        customerId: customer.id,
        locationId: location.id,
        status: "CANCELED",
      })
    ).json();
    const resurrect = await app.inject({
      method: "PATCH",
      url: `/api/v1/jobs/${canceled.id}/status`,
      headers: asAccount(),
      payload: { status: "SCHEDULED" },
    });
    expect(resurrect.statusCode).toBe(409);

    const noShow = (
      await createJob({
        title: "No-show job",
        customerId: customer.id,
        locationId: location.id,
        status: "NO_SHOW",
      })
    ).json();
    const rebooked = await app.inject({
      method: "PATCH",
      url: `/api/v1/jobs/${noShow.id}/status`,
      headers: asAccount(),
      payload: { status: "SCHEDULED" },
    });
    expect(rebooked.statusCode).toBe(200);
    expect(rebooked.json().status).toBe("SCHEDULED");
  });

  it("persists cancelReason and blocks reusing a canceled slot", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const job = (
      await createJob({
        title: "Weather cancellation",
        customerId: customer.id,
        locationId: location.id,
        status: "SCHEDULED",
      })
    ).json();

    const canceled = await app.inject({
      method: "PATCH",
      url: `/api/v1/jobs/${job.id}/status`,
      headers: asAccount(),
      payload: { status: "CANCELED", cancelReason: "Storm" },
    });
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json()).toMatchObject({
      status: "CANCELED",
      cancelReason: "Storm",
    });

    const after = await app.inject({
      method: "PATCH",
      url: `/api/v1/jobs/${job.id}`,
      headers: asAccount(),
      payload: { status: "SCHEDULED" },
    });
    expect(after.statusCode).toBe(409);
  });

  it("records exactly one completion activity via PATCH and /status", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);

    const viaPatch = (
      await createJob({
        title: "Completed through patch",
        customerId: customer.id,
        locationId: location.id,
        status: "SCHEDULED",
      })
    ).json();
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/jobs/${viaPatch.id}`,
      headers: asAccount(),
      payload: { status: "COMPLETED", rating: 5, ratingNote: "Spotless" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      status: "COMPLETED",
      rating: 5,
      ratingNote: "Spotless",
    });
    expect(patched.json().completedAt).not.toBeNull();

    const repeat = await app.inject({
      method: "PATCH",
      url: `/api/v1/jobs/${viaPatch.id}/status`,
      headers: asAccount(),
      payload: { status: "COMPLETED" },
    });
    expect(repeat.statusCode).toBe(200);

    const viaStatus = (
      await createJob({
        title: "Completed through status",
        customerId: customer.id,
        locationId: location.id,
        status: "SCHEDULED",
      })
    ).json();
    const statused = await app.inject({
      method: "PATCH",
      url: `/api/v1/jobs/${viaStatus.id}/status`,
      headers: asAccount(),
      payload: { status: "COMPLETED" },
    });
    expect(statused.statusCode).toBe(200);

    const patchActivity = await prisma.activity.count({
      where: {
        workspaceId: account.workspaceId,
        title: { contains: viaPatch.title },
      },
    });
    const statusActivity = await prisma.activity.count({
      where: {
        workspaceId: account.workspaceId,
        title: { contains: viaStatus.title },
      },
    });
    expect(patchActivity).toBe(1);
    expect(statusActivity).toBe(1);

    const audits = await prisma.auditLog.count({
      where: {
        workspaceId: account.workspaceId,
        action: "job.status_changed",
        entityId: viaPatch.id,
      },
    });
    expect(audits).toBe(1);

    const fetched = await app.inject({
      method: "GET",
      url: `/api/v1/jobs/${viaPatch.id}`,
      headers: asAccount(),
    });
    expect(fetched.json()).toMatchObject({ rating: 5, ratingNote: "Spotless" });
  });

  it("rejects overlapping work for the same technician", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const base = Date.now() + 2 * 3_600_000;
    const start = new Date(base).toISOString();
    const overlapping = new Date(base + 30 * 60_000).toISOString();

    const first = await createJob({
      title: "Booked slot",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      assigneeId: account.userId,
      scheduledStart: start,
      durationMinutes: 60,
    });
    expect(first.statusCode).toBe(201);
    const booked = first.json();

    const conflictCreate = await createJob({
      title: "Overlapping slot",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      assigneeId: account.userId,
      scheduledStart: overlapping,
    });
    expect(conflictCreate.statusCode).toBe(409);
    expect(conflictCreate.json().error.details.jobNumber).toBe(booked.number);

    const third = (
      await createJob({
        title: "Awaiting technician",
        customerId: customer.id,
        locationId: location.id,
        status: "SCHEDULED",
        scheduledStart: start,
      })
    ).json();
    const conflictPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/jobs/${third.id}`,
      headers: asAccount(),
      payload: { assigneeId: account.userId },
    });
    expect(conflictPatch.statusCode).toBe(409);

    const canceled = await app.inject({
      method: "PATCH",
      url: `/api/v1/jobs/${booked.id}/status`,
      headers: asAccount(),
      payload: { status: "CANCELED" },
    });
    expect(canceled.statusCode).toBe(200);

    const afterCancel = await createJob({
      title: "Freed slot",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      assigneeId: account.userId,
      scheduledStart: overlapping,
    });
    expect(afterCancel.statusCode).toBe(201);
  });
});

describe("estimate line costs", () => {
  it("copies ServiceItem.cost into estimate, converted job and duplicate lines", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const service = await createService({ price: 15000, cost: 4200 });

    const estimate = (
      await app.inject({
        method: "POST",
        url: "/api/v1/estimates",
        headers: asAccount(),
        payload: {
          title: "Costed estimate",
          customerId: customer.id,
          locationId: location.id,
          status: "SENT",
          lineItems: [
            {
              serviceId: service.id,
              name: service.name,
              quantity: 1,
              unitPrice: service.price,
            },
          ],
        },
      })
    ).json();
    expect(estimate.lineItems[0].unitCost).toBe(4200);

    const converted = await app.inject({
      method: "POST",
      url: `/api/v1/estimates/${estimate.id}/convert`,
      headers: asAccount(),
      payload: {},
    });
    expect(converted.statusCode).toBe(201);
    expect(converted.json().lineItems[0].unitCost).toBe(4200);

    const job = (
      await createJob({
        title: "Costed job",
        customerId: customer.id,
        locationId: location.id,
        lineItems: [
          {
            serviceId: service.id,
            name: service.name,
            quantity: 1,
            unitPrice: service.price,
          },
        ],
      })
    ).json();
    expect(job.lineItems[0].unitCost).toBe(4200);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/jobs/${job.id}/duplicate`,
      headers: asAccount(),
      payload: {},
    });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json().lineItems[0].unitCost).toBe(4200);
  });
});

describe("invoice money rules", () => {
  async function createInvoice(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: asAccount(),
      payload,
    });
  }

  it("keeps amountPaid intact when an invoice is marked paid", async () => {
    const customer = await createCustomer();
    const created = await createInvoice({
      title: "Never overwrite payments",
      customerId: customer.id,
      amount: 50000,
      status: "SENT",
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(created.statusCode).toBe(201);
    const invoice = created.json();

    const premature = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
      payload: { status: "PAID" },
    });
    expect(premature.statusCode).toBe(400);
    const untouched = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
    });
    expect(untouched.json()).toMatchObject({
      status: "SENT",
      amountPaid: 0,
      balance: 50000,
    });

    const partial = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/payments`,
      headers: asAccount(),
      payload: { amount: 20000, method: "CASH" },
    });
    expect(partial.statusCode).toBe(201);
    expect(partial.json()).toMatchObject({
      status: "PARTIAL",
      amountPaid: 20000,
    });

    const stillPremature = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
      payload: { status: "PAID" },
    });
    expect(stillPremature.statusCode).toBe(400);
    const preserved = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
    });
    expect(preserved.json().amountPaid).toBe(20000);

    const settled = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/payments`,
      headers: asAccount(),
      payload: { amount: 30000, method: "ACH" },
    });
    expect(settled.statusCode).toBe(201);
    expect(settled.json()).toMatchObject({
      status: "PAID",
      amountPaid: 50000,
      balance: 0,
    });

    const ledger = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${invoice.id}/payments`,
      headers: asAccount(),
    });
    expect(ledger.statusCode).toBe(200);
    const payments = ledger.json() as Array<{ amount: number; method: string }>;
    expect(payments).toHaveLength(2);
    expect(payments.reduce((sum, payment) => sum + payment.amount, 0)).toBe(
      50000,
    );

    const belowPaid = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
      payload: { amount: 40000 },
    });
    expect(belowPaid.statusCode).toBe(400);

    const reopened = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
      payload: { status: "PARTIAL" },
    });
    expect(reopened.statusCode).toBe(409);
  });

  it("keeps the caller's amountPaid when the amount changes", async () => {
    const customer = await createCustomer();
    const created = await createInvoice({
      title: "Resized invoice",
      customerId: customer.id,
      amount: 50000,
      status: "SENT",
    });
    const invoice = created.json();

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
      payload: { amount: 60000, amountPaid: 20000 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      amount: 60000,
      amountPaid: 20000,
      status: "PARTIAL",
      balance: 40000,
    });

    const ledger = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${invoice.id}/payments`,
      headers: asAccount(),
    });
    expect(ledger.json()).toHaveLength(1);
    expect(ledger.json()[0]).toMatchObject({ amount: 20000, method: "CARD" });
  });

  it("cannot mark a zero-total invoice paid", async () => {
    const customer = await createCustomer();
    const created = await createInvoice({
      title: "Zero total",
      customerId: customer.id,
      amount: 0,
      status: "SENT",
    });
    expect(created.statusCode).toBe(201);
    const invoice = created.json();

    const paid = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
      payload: { status: "PAID" },
    });
    expect(paid.statusCode).toBe(400);

    const cash = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/payments`,
      headers: asAccount(),
      payload: { amount: 1 },
    });
    expect(cash.statusCode).toBe(400);

    const fetched = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
    });
    expect(fetched.json()).toMatchObject({
      status: "SENT",
      amountPaid: 0,
      balance: 0,
      overdue: false,
    });
  });

  it("refuses to void an invoice that already has payments", async () => {
    const customer = await createCustomer();
    const created = await createInvoice({
      title: "Partially paid",
      customerId: customer.id,
      amount: 10000,
      status: "SENT",
    });
    const invoice = created.json();

    const partial = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/payments`,
      headers: asAccount(),
      payload: { amount: 5000 },
    });
    expect(partial.statusCode).toBe(201);

    const voided = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
      payload: { status: "VOID" },
    });
    expect(voided.statusCode).toBe(400);
    const after = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${invoice.id}`,
      headers: asAccount(),
    });
    expect(after.json().status).toBe("PARTIAL");

    const clean = (
      await createInvoice({
        title: "Voidable",
        customerId: customer.id,
        amount: 10000,
        status: "SENT",
      })
    ).json();
    const voidedClean = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${clean.id}`,
      headers: asAccount(),
      payload: { status: "VOID" },
    });
    expect(voidedClean.statusCode).toBe(200);
    expect(voidedClean.json().status).toBe("VOID");

    const paymentOnVoid = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${clean.id}/payments`,
      headers: asAccount(),
      payload: { amount: 100 },
    });
    expect(paymentOnVoid.statusCode).toBe(409);
  });

  it("intersects the overdue filter with the requested status", async () => {
    const customer = await createCustomer();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();

    const overdueSent = (
      await createInvoice({
        title: "Overdue sent",
        customerId: customer.id,
        amount: 10000,
        status: "SENT",
        dueAt: past,
      })
    ).json();
    await createInvoice({
      title: "Overdue draft",
      customerId: customer.id,
      amount: 10000,
      status: "DRAFT",
      dueAt: past,
    });
    await createInvoice({
      title: "Future sent",
      customerId: customer.id,
      amount: 10000,
      status: "SENT",
      dueAt: future,
    });
    const overduePaid = (
      await createInvoice({
        title: "Overdue then paid",
        customerId: customer.id,
        amount: 10000,
        status: "SENT",
        dueAt: past,
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${overduePaid.id}/payments`,
      headers: asAccount(),
      payload: { amount: 10000 },
    });

    const overdue = await app.inject({
      method: "GET",
      url: "/api/v1/invoices?overdue=true",
      headers: asAccount(),
    });
    expect(
      overdue.json().data.map((row: { title: string }) => row.title),
    ).toEqual(["Overdue sent"]);

    const paidIntersect = await app.inject({
      method: "GET",
      url: "/api/v1/invoices?overdue=true&status=PAID",
      headers: asAccount(),
    });
    expect(paidIntersect.json().data).toHaveLength(0);

    const sentIntersect = await app.inject({
      method: "GET",
      url: "/api/v1/invoices?overdue=true&status=SENT",
      headers: asAccount(),
    });
    expect(
      sentIntersect.json().data.map((row: { id: string }) => row.id),
    ).toEqual([overdueSent.id]);
  });
});

describe("primary location invariants", () => {
  it("promotes another active location when the primary is archived", async () => {
    const customer = await createCustomer();
    const first = await createLocation(customer.id, {
      label: "Main",
      isPrimary: true,
    });
    const second = await createLocation(customer.id, { label: "Annex" });
    expect(second.isPrimary).toBe(false);

    const archived = await app.inject({
      method: "DELETE",
      url: `/api/v1/locations/${first.id}`,
      headers: asAccount(),
    });
    expect(archived.statusCode).toBe(204);

    const promoted = await app.inject({
      method: "GET",
      url: `/api/v1/locations/${second.id}`,
      headers: asAccount(),
    });
    expect(promoted.json()).toMatchObject({ isPrimary: true, archived: false });

    const demote = await app.inject({
      method: "PATCH",
      url: `/api/v1/locations/${second.id}`,
      headers: asAccount(),
      payload: { isPrimary: false },
    });
    expect(demote.statusCode).toBe(400);

    const unchanged = await app.inject({
      method: "GET",
      url: `/api/v1/locations/${second.id}`,
      headers: asAccount(),
    });
    expect(unchanged.json().isPrimary).toBe(true);
  });

  it("rejects archiving the only active primary location", async () => {
    const customer = await createCustomer();
    const only = await createLocation(customer.id, { isPrimary: true });

    const archived = await app.inject({
      method: "DELETE",
      url: `/api/v1/locations/${only.id}`,
      headers: asAccount(),
    });
    expect(archived.statusCode).toBe(400);

    const fetched = await app.inject({
      method: "GET",
      url: `/api/v1/locations/${only.id}`,
      headers: asAccount(),
    });
    expect(fetched.json()).toMatchObject({ archived: false, isPrimary: true });
  });
});
