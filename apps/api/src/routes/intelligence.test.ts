import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import type { AssistantBrief, IntelligenceSummary } from "@meridian/contracts";
import { prisma } from "../lib/db.js";
import {
  authHeaders,
  createTestApp,
  registerAccount,
  resetDatabase,
  type TestAccount,
} from "../test/helpers.js";

const DAY_MS = 86_400_000;

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

async function getSummary(
  target: TestAccount = account,
): Promise<IntelligenceSummary> {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/intelligence/summary",
    headers: authHeaders(target),
  });
  expect(response.statusCode).toBe(200);
  return response.json() as IntelligenceSummary;
}

function tag(): string {
  return crypto.randomUUID().slice(0, 8);
}

async function seedCustomer(
  name = `Customer ${tag()}`,
  workspaceId = account.workspaceId,
) {
  return prisma.company.create({
    data: {
      workspaceId,
      name,
      phone: "503-555-0100",
      customerType: "RESIDENTIAL",
    },
  });
}

async function seedLocation(
  customerId: string,
  workspaceId = account.workspaceId,
) {
  return prisma.location.create({
    data: {
      workspaceId,
      customerId,
      label: "Main",
      line1: "412 Alder Street",
      city: "Portland",
      state: "OR",
      postalCode: "97205",
      isPrimary: true,
    },
  });
}

async function seedJob(
  customerId: string,
  locationId: string,
  overrides: Partial<Prisma.JobUncheckedCreateInput> = {},
  workspaceId = account.workspaceId,
) {
  return prisma.job.create({
    data: {
      workspaceId,
      number: `JOB-${tag()}`,
      title: "Service visit",
      customerId,
      locationId,
      ...overrides,
    } as Prisma.JobUncheckedCreateInput,
  });
}

describe("intelligence recommendations", () => {
  it("flags a customer with no job in 90 days and no upcoming visit as churn risk", async () => {
    const customer = await seedCustomer("Dormant Customer");
    const location = await seedLocation(customer.id);
    await seedJob(customer.id, location.id, {
      status: "COMPLETED",
      completedAt: new Date(Date.now() - 120 * DAY_MS),
      scheduledStart: new Date(Date.now() - 120 * DAY_MS),
      total: 15_000,
    });

    const summary = await getSummary();
    const recommendation = summary.recommendations.find(
      (row) => row.kind === "CHURN_RISK",
    );

    expect(recommendation).toBeDefined();
    expect(recommendation?.customer?.id).toBe(customer.id);
    expect(recommendation?.rationale).toContain("120 days");
    expect(recommendation?.rationale).toContain("Churn risk");
    expect(recommendation?.value).toBeGreaterThan(0);
    expect(recommendation?.href).toContain(customer.id);
    expect(summary.health.churnRiskCustomers).toBe(1);
    expect(summary.counts.CHURN_RISK).toBe(1);
  });

  it("flags an upcoming job for a customer with a prior no-show", async () => {
    const customer = await seedCustomer("Repeat No-show");
    const location = await seedLocation(customer.id);
    await seedJob(customer.id, location.id, {
      status: "NO_SHOW",
      scheduledStart: new Date(Date.now() - 20 * DAY_MS),
      total: 10_000,
    });
    const upcoming = await seedJob(customer.id, location.id, {
      status: "SCHEDULED",
      scheduledStart: new Date(Date.now() + 5 * DAY_MS),
      total: 20_000,
    });

    const summary = await getSummary();
    const recommendation = summary.recommendations.find(
      (row) => row.kind === "NO_SHOW_RISK",
    );

    expect(recommendation).toBeDefined();
    expect(recommendation?.jobId).toBe(upcoming.id);
    expect(recommendation?.jobNumber).toBe(upcoming.number);
    expect(recommendation?.rationale).toContain("No-show risk");
    expect(recommendation?.detail).toContain("prior no-show");
    expect(recommendation?.href).toContain(upcoming.id);
    expect(summary.health.noShowRiskJobs).toBe(1);
  });

  it("scores unpurchased active services and exposes the top upsells", async () => {
    const customer = await seedCustomer("Ready To Upsell");
    const location = await seedLocation(customer.id);
    await seedJob(customer.id, location.id, {
      status: "COMPLETED",
      completedAt: new Date(Date.now() - 45 * DAY_MS),
      scheduledStart: new Date(Date.now() - 45 * DAY_MS),
      total: 12_000,
    });
    const service = await prisma.serviceItem.create({
      data: {
        workspaceId: account.workspaceId,
        name: "Gutter clean",
        category: "Exterior",
        unit: "VISIT",
        price: 20_000,
        cost: 5_000,
      },
    });

    const summary = await getSummary();
    const recommendation = summary.recommendations.find(
      (row) => row.kind === "UPSELL",
    );

    expect(recommendation).toBeDefined();
    expect(recommendation?.serviceId).toBe(service.id);
    expect(recommendation?.serviceName).toBe(service.name);
    expect(recommendation?.value).toBe(20_000);
    expect(recommendation?.rationale).toContain("Upsell fit");
    expect(summary.upsells[0]?.serviceId).toBe(service.id);
    expect(summary.upsells[0]?.customer.id).toBe(customer.id);
  });

  it("marks large overdue balances as high severity collections", async () => {
    const customer = await seedCustomer("Slow Payer");
    const invoice = await prisma.invoice.create({
      data: {
        workspaceId: account.workspaceId,
        number: `INV-${tag()}`,
        title: "Completed work",
        status: "SENT",
        customerId: customer.id,
        amount: 80_000,
        amountPaid: 0,
        issuedAt: new Date(Date.now() - 45 * DAY_MS),
        dueAt: new Date(Date.now() - 40 * DAY_MS),
      },
    });

    const summary = await getSummary();
    const recommendation = summary.recommendations.find(
      (row) => row.kind === "COLLECTIONS",
    );

    expect(recommendation).toBeDefined();
    expect(recommendation?.severity).toBe("HIGH");
    expect(recommendation?.value).toBe(80_000);
    expect(recommendation?.customer?.id).toBe(customer.id);
    expect(recommendation?.detail).toContain("past due");
    expect(recommendation?.href).toContain(invoice.id);
    expect(summary.health.overdueAmount).toBe(80_000);

    const filtered = await app.inject({
      method: "GET",
      url: "/api/v1/intelligence/recommendations?kind=COLLECTIONS&limit=1",
      headers: authHeaders(account),
    });
    expect(filtered.statusCode).toBe(200);
    expect(
      (filtered.json() as { kind: string }[]).map((row) => row.kind),
    ).toEqual(["COLLECTIONS"]);
  });

  it("builds an explainable forecast from scheduled, pipeline and recurring data", async () => {
    const customer = await seedCustomer("Forecast Customer");
    const location = await seedLocation(customer.id);
    const now = Date.now();
    const monthEnd = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1),
    ).getTime();
    // Stay safely inside the current month while remaining after the request's clock.
    const offset = Math.max(1_000, Math.floor((monthEnd - now) / 2));
    const scheduledStart = new Date(now + Math.min(3_600_000, offset));

    await seedJob(customer.id, location.id, {
      status: "SCHEDULED",
      scheduledStart,
      total: 50_000,
    });
    await seedJob(customer.id, location.id, {
      status: "COMPLETED",
      completedAt: new Date(now - 30 * DAY_MS),
      scheduledStart: new Date(now - 30 * DAY_MS),
      recurrence: "MONTHLY",
      total: 60_000,
    });

    const stage = await prisma.stage.findFirstOrThrow({
      where: { pipeline: { workspaceId: account.workspaceId } },
      orderBy: { order: "asc" },
    });
    await prisma.deal.create({
      data: {
        workspaceId: account.workspaceId,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        title: "Proposal",
        value: 100_000,
      },
    });

    const summary = await getSummary();
    const expectedPipeline = Math.round((100_000 * stage.probability) / 100);

    expect(summary.forecast.scheduled).toBeGreaterThanOrEqual(50_000);
    expect(summary.forecast.pipelineWeighted).toBe(expectedPipeline);
    expect(summary.forecast.recurring).toBe(20_000);
    expect(summary.forecast.next30Days).toBe(
      summary.forecast.scheduled +
        summary.forecast.pipelineWeighted +
        summary.forecast.recurring,
    );
    expect(summary.forecast.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(["low", "medium", "high"]).toContain(summary.forecast.confidence);

    const recommendation = summary.recommendations.find(
      (row) => row.kind === "REVENUE_FORECAST",
    );
    expect(recommendation?.value).toBe(summary.forecast.next30Days);

    const briefResponse = await app.inject({
      method: "GET",
      url: "/api/v1/intelligence/brief",
      headers: authHeaders(account),
    });
    expect(briefResponse.statusCode).toBe(200);
    const brief = briefResponse.json() as AssistantBrief;
    expect(brief.headline.length).toBeGreaterThan(0);
    expect(brief.bullets.length).toBeGreaterThanOrEqual(3);
    expect(brief.bullets.length).toBeLessThanOrEqual(5);
    expect(brief.focus.length).toBeLessThanOrEqual(3);
  });

  it("keeps every recommendation scoped to the caller's workspace", async () => {
    const customer = await seedCustomer("Owner A Customer");
    const location = await seedLocation(customer.id);
    await seedJob(customer.id, location.id, {
      status: "COMPLETED",
      completedAt: new Date(Date.now() - 120 * DAY_MS),
      scheduledStart: new Date(Date.now() - 120 * DAY_MS),
      total: 15_000,
    });
    await prisma.invoice.create({
      data: {
        workspaceId: account.workspaceId,
        number: `INV-${tag()}`,
        title: "Overdue",
        status: "SENT",
        customerId: customer.id,
        amount: 60_000,
        amountPaid: 0,
        dueAt: new Date(Date.now() - 35 * DAY_MS),
      },
    });

    const ownerSummary = await getSummary();
    expect(ownerSummary.recommendations.length).toBeGreaterThan(0);

    const other = await registerAccount(app, {
      email: `other-${tag()}@example.com`,
    });
    const otherSummary = await getSummary(other);

    expect(otherSummary.recommendations).toEqual([]);
    expect(otherSummary.upsells).toEqual([]);
    expect(
      Object.values(otherSummary.counts).every((count) => count === 0),
    ).toBe(true);
    expect(otherSummary.health.overdueAmount).toBe(0);
    expect(otherSummary.health.churnRiskCustomers).toBe(0);

    const otherRecommendations = await app.inject({
      method: "GET",
      url: "/api/v1/intelligence/recommendations",
      headers: authHeaders(other),
    });
    expect(otherRecommendations.statusCode).toBe(200);
    expect(otherRecommendations.json()).toEqual([]);

    const otherBrief = await app.inject({
      method: "GET",
      url: "/api/v1/intelligence/brief",
      headers: authHeaders(other),
    });
    expect(otherBrief.statusCode).toBe(200);
    expect((otherBrief.json() as AssistantBrief).focus).toEqual([]);
  });
});
