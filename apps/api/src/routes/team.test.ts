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

interface WorkspaceSeed {
  workspaceId: string;
  customerId: string;
  locationId: string;
  nextNumber: number;
}

async function seedWorkspace(workspaceId: string): Promise<WorkspaceSeed> {
  const customer = await prisma.company.create({
    data: { workspaceId, name: "Cedar & Co" },
  });
  const location = await prisma.location.create({
    data: {
      workspaceId,
      customerId: customer.id,
      line1: "412 Alder Street",
      city: "Portland",
    },
  });
  return { workspaceId, customerId: customer.id, locationId: location.id, nextNumber: 1 };
}

async function addMember(workspaceId: string, name: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, "")}-${crypto.randomUUID()}@example.com`,
      passwordHash: "test-only",
    },
  });
  await prisma.membership.create({
    data: { workspaceId, userId: user.id, role: "MEMBER" },
  });
  return user.id;
}

interface JobSeed {
  assigneeId?: string | null;
  status?: string;
  scheduledStart?: string | null;
  completedAt?: string | null;
  durationMinutes?: number;
  rating?: number | null;
  subtotal?: number;
  total?: number;
  lineCost?: number;
}

async function seedJob(seed: WorkspaceSeed, job: JobSeed): Promise<string> {
  const number = `JOB-${seed.nextNumber}`;
  seed.nextNumber += 1;
  const total = job.total ?? job.subtotal ?? 0;
  const created = await prisma.job.create({
    data: {
      workspaceId: seed.workspaceId,
      number,
      title: number,
      customerId: seed.customerId,
      locationId: seed.locationId,
      assigneeId: job.assigneeId ?? null,
      status: job.status ?? "SCHEDULED",
      scheduledStart: job.scheduledStart ? new Date(job.scheduledStart) : null,
      completedAt: job.completedAt ? new Date(job.completedAt) : null,
      durationMinutes: job.durationMinutes ?? 60,
      rating: job.rating ?? null,
      subtotal: job.subtotal ?? 0,
      total,
      lineItems:
        job.lineCost !== undefined
          ? {
              create: [
                {
                  name: "Labor",
                  quantity: 1,
                  unitPrice: job.subtotal ?? 0,
                  unitCost: job.lineCost,
                  total: job.subtotal ?? 0,
                },
              ],
            }
          : undefined,
    },
  });
  return created.id;
}

async function seedPayment(
  seed: WorkspaceSeed,
  jobId: string,
  amount: number,
  receivedAt: string,
): Promise<void> {
  const number = `INV-${seed.nextNumber}`;
  seed.nextNumber += 1;
  const invoice = await prisma.invoice.create({
    data: {
      workspaceId: seed.workspaceId,
      number,
      title: number,
      customerId: seed.customerId,
      jobId,
      amount,
      status: "PAID",
    },
  });
  await prisma.payment.create({
    data: {
      workspaceId: seed.workspaceId,
      invoiceId: invoice.id,
      amount,
      receivedAt: new Date(receivedAt),
    },
  });
}

function getPerformance(url = "/api/v1/team/performance") {
  return app.inject({ method: "GET", url, headers: authHeaders(account) });
}

function getWorkload(date?: string) {
  const url = date ? `/api/v1/team/workload?date=${date}` : "/api/v1/team/workload";
  return app.inject({ method: "GET", url, headers: authHeaders(account) });
}

describe("team performance", () => {
  it("attributes jobs, revenue, margin and ratings to the assigned member", async () => {
    const seed = await seedWorkspace(account.workspaceId);
    const memberId = await addMember(account.workspaceId, "Alex Member");
    const idleId = await addMember(account.workspaceId, "Idle Member");

    const completedJob = await seedJob(seed, {
      assigneeId: account.userId,
      status: "COMPLETED",
      scheduledStart: "2020-01-06T09:00:00.000Z",
      completedAt: "2020-01-06T10:00:00.000Z",
      durationMinutes: 90,
      rating: 5,
      subtotal: 10_000,
      total: 10_000,
      lineCost: 3_000,
    });
    await seedJob(seed, {
      assigneeId: account.userId,
      status: "CANCELED",
      scheduledStart: "2020-01-06T11:00:00.000Z",
    });
    await seedJob(seed, {
      assigneeId: account.userId,
      status: "NO_SHOW",
      scheduledStart: "2020-01-06T12:00:00.000Z",
    });

    const memberCompleted = await seedJob(seed, {
      assigneeId: memberId,
      status: "COMPLETED",
      scheduledStart: "2020-01-06T09:30:00.000Z",
      completedAt: "2020-01-06T11:00:00.000Z",
      durationMinutes: 120,
      rating: 4,
      subtotal: 5_000,
      total: 5_000,
      lineCost: 1_000,
    });
    await seedJob(seed, {
      assigneeId: memberId,
      status: "SCHEDULED",
      scheduledStart: "2020-01-06T14:00:00.000Z",
    });

    await seedPayment(seed, completedJob, 10_000, "2020-01-06T10:30:00.000Z");
    await seedPayment(seed, memberCompleted, 5_000, "2020-01-06T11:30:00.000Z");
    // Outside the requested range: must not inflate revenue.
    await seedPayment(seed, completedJob, 999, "2020-02-01T10:30:00.000Z");

    const response = await getPerformance(
      "/api/v1/team/performance?from=2020-01-06T00:00:00.000Z&to=2020-01-06T23:59:59.999Z",
    );
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.range).toEqual({
      from: "2020-01-06T00:00:00.000Z",
      to: "2020-01-06T23:59:59.999Z",
    });
    expect(body.currency).toBe("USD");
    expect(body.members).toHaveLength(3);

    const owner = body.members.find((row: { user: { id: string } }) => row.user.id === account.userId);
    expect(owner.role).toBe("OWNER");
    expect(owner).toMatchObject({
      jobsScheduled: 3,
      jobsCompleted: 1,
      jobsCanceled: 1,
      jobsNoShow: 1,
      revenue: 10_000,
      margin: 7_000,
      avgTicket: 10_000,
      utilizationPct: 19,
      ratingAvg: 5,
      ratingCount: 1,
      openJobs: 0,
      upcomingMinutes: 0,
    });

    const member = body.members.find((row: { user: { id: string } }) => row.user.id === memberId);
    expect(member.role).toBe("MEMBER");
    expect(member).toMatchObject({
      jobsScheduled: 2,
      jobsCompleted: 1,
      jobsCanceled: 0,
      jobsNoShow: 0,
      revenue: 5_000,
      margin: 4_000,
      avgTicket: 5_000,
      utilizationPct: 25,
      ratingAvg: 4,
      ratingCount: 1,
      openJobs: 1,
      upcomingMinutes: 0,
    });

    const idle = body.members.find((row: { user: { id: string } }) => row.user.id === idleId);
    expect(idle).toMatchObject({
      jobsScheduled: 0,
      jobsCompleted: 0,
      revenue: 0,
      margin: 0,
      avgTicket: 0,
      utilizationPct: 0,
      ratingAvg: null,
      ratingCount: 0,
      openJobs: 0,
      upcomingMinutes: 0,
    });

    expect(body.totals).toEqual({
      jobsScheduled: 5,
      jobsCompleted: 2,
      revenue: 15_000,
      margin: 11_000,
      avgTicket: 7_500,
      utilizationPct: 15,
      ratingAvg: 4.5,
    });
  });

  it("defaults to the last 30 days and caps the range at 366 days", async () => {
    const seed = await seedWorkspace(account.workspaceId);
    const now = Date.now();
    await seedJob(seed, {
      assigneeId: account.userId,
      status: "COMPLETED",
      scheduledStart: new Date(now - 2 * 86_400_000).toISOString(),
      completedAt: new Date(now - 2 * 86_400_000).toISOString(),
      subtotal: 1_000,
      total: 1_000,
    });
    await seedJob(seed, {
      assigneeId: account.userId,
      status: "COMPLETED",
      scheduledStart: new Date(now - 500 * 86_400_000).toISOString(),
      completedAt: new Date(now - 500 * 86_400_000).toISOString(),
    });

    const defaulted = await getPerformance();
    expect(defaulted.statusCode).toBe(200);
    expect(defaulted.json().members[0].jobsCompleted).toBe(1);

    const capped = await getPerformance(
      `/api/v1/team/performance?from=${new Date(now - 500 * 86_400_000).toISOString()}&to=${new Date(now).toISOString()}`,
    );
    expect(capped.statusCode).toBe(200);
    const span =
      new Date(capped.json().range.to).getTime() - new Date(capped.json().range.from).getTime();
    expect(span).toBe(366 * 86_400_000);
    expect(capped.json().members[0].jobsCompleted).toBe(1);

    const inverted = await getPerformance(
      "/api/v1/team/performance?from=2020-02-01T00:00:00.000Z&to=2020-01-01T00:00:00.000Z",
    );
    expect(inverted.statusCode).toBe(400);
    expect(inverted.json().error.code).toBe("BAD_REQUEST");
  });
});

describe("team workload", () => {
  it("summarizes capacity, next starts and unassigned work for a date", async () => {
    const seed = await seedWorkspace(account.workspaceId);
    const memberId = await addMember(account.workspaceId, "Blair Member");

    await seedJob(seed, {
      assigneeId: account.userId,
      status: "SCHEDULED",
      scheduledStart: "2099-01-05T09:00:00.000Z",
      durationMinutes: 120,
    });
    await seedJob(seed, {
      assigneeId: account.userId,
      status: "IN_PROGRESS",
      scheduledStart: "2099-01-05T13:00:00.000Z",
      durationMinutes: 60,
    });
    await seedJob(seed, {
      assigneeId: account.userId,
      status: "CANCELED",
      scheduledStart: "2099-01-05T15:00:00.000Z",
      durationMinutes: 30,
    });
    await seedJob(seed, {
      assigneeId: account.userId,
      status: "COMPLETED",
      completedAt: "2099-01-05T12:00:00.000Z",
      durationMinutes: 45,
    });
    await seedJob(seed, {
      assigneeId: memberId,
      status: "SCHEDULED",
      scheduledStart: "2099-01-05T10:00:00.000Z",
      durationMinutes: 180,
    });
    await seedJob(seed, {
      assigneeId: null,
      status: "SCHEDULED",
      scheduledStart: "2099-01-05T11:00:00.000Z",
      durationMinutes: 60,
    });

    const response = await getWorkload("2099-01-05");
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.date).toBe("2099-01-05");
    expect(body.unassigned).toBe(1);
    expect(body.totalScheduledMinutes).toBe(360);

    const owner = body.members.find((row: { user: { id: string } }) => row.user.id === account.userId);
    expect(owner).toEqual({
      user: expect.objectContaining({ id: account.userId }),
      jobCount: 2,
      scheduledMinutes: 180,
      capacityMinutes: 480,
      utilizationPct: 38,
      nextStart: "2099-01-05T09:00:00.000Z",
      jobsCompletedToday: 1,
    });

    const member = body.members.find((row: { user: { id: string } }) => row.user.id === memberId);
    expect(member).toMatchObject({
      jobCount: 1,
      scheduledMinutes: 180,
      capacityMinutes: 480,
      utilizationPct: 38,
      nextStart: "2099-01-05T10:00:00.000Z",
      jobsCompletedToday: 0,
    });
  });

  it("rejects malformed dates", async () => {
    const response = await getWorkload("2020-13-40");
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("BAD_REQUEST");
  });
});

describe("team tenant isolation", () => {
  it("never leaks another workspace's members, jobs or payments", async () => {
    const other = await registerAccount(app, { name: "Other Owner" });
    const otherSeed = await seedWorkspace(other.workspaceId);

    const today = new Date();
    const start = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 9),
    );
    const scheduled = start.toISOString();
    const otherJob = await seedJob(otherSeed, {
      assigneeId: other.userId,
      status: "SCHEDULED",
      scheduledStart: scheduled,
      durationMinutes: 240,
      subtotal: 9_000,
      total: 9_000,
      lineCost: 0,
    });
    await seedJob(otherSeed, {
      assigneeId: null,
      status: "SCHEDULED",
      scheduledStart: start.toISOString(),
      durationMinutes: 60,
    });
    await seedPayment(otherSeed, otherJob, 9_000, new Date().toISOString());

    const performance = await getPerformance();
    expect(performance.statusCode).toBe(200);
    expect(performance.json().members).toHaveLength(1);
    expect(performance.json().members[0].user.id).toBe(account.userId);
    expect(performance.json().totals.revenue).toBe(0);
    expect(performance.json().totals.jobsScheduled).toBe(0);

    const workload = await getWorkload(start.toISOString().slice(0, 10));
    expect(workload.statusCode).toBe(200);
    expect(workload.json().members).toHaveLength(1);
    expect(workload.json().members[0].user.id).toBe(account.userId);
    expect(workload.json().unassigned).toBe(0);
    expect(workload.json().totalScheduledMinutes).toBe(0);
  });
});
