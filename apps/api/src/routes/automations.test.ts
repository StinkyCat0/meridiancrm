import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import { emitEvent } from "../lib/events.js";
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

interface CustomerRow {
  id: string;
  name: string;
}

interface JobRow {
  id: string;
  number: string;
  title: string;
}

async function createCustomer(name = "Cedar & Co"): Promise<CustomerRow> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/companies",
    headers: asAccount(),
    payload: {
      name,
      customerType: "RESIDENTIAL",
      email: "cedar@example.com",
      phone: "503-555-0100",
      industry: "Cleaning",
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<CustomerRow>();
}

async function createLocation(customerId: string): Promise<{ id: string }> {
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
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>();
}

async function createJob(
  customerId: string,
  locationId: string,
  extra: Record<string, unknown> = {},
): Promise<JobRow> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/jobs",
    headers: asAccount(),
    payload: {
      title: "Deep clean",
      customerId,
      locationId,
      status: "SCHEDULED",
      priority: "NORMAL",
      scheduledStart: new Date(Date.now() + 3_600_000).toISOString(),
      ...extra,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<JobRow>();
}

async function createRule(
  payload: Record<string, unknown>,
  target: TestAccount = account,
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/automations",
    headers: asAccount(target),
    payload,
  });
}

interface RunRow {
  ruleId: string;
  status: string;
  trigger: string;
  entityId: string | null;
  detail: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  type: string;
}

interface PageBody<T> {
  data: T[];
  meta: { total: number };
}

async function listRuns(
  query = "",
  target: TestAccount = account,
): Promise<PageBody<RunRow>> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/automations/runs${query}`,
    headers: asAccount(target),
  });
  expect(response.statusCode).toBe(200);
  return response.json<PageBody<RunRow>>();
}

async function listTasks(): Promise<TaskRow[]> {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/activities?type=TASK",
    headers: asAccount(),
  });
  expect(response.statusCode).toBe(200);
  return response.json<PageBody<TaskRow>>().data;
}

describe("automation rules CRUD", () => {
  it("creates, lists, reads, patches and deletes rules with JSON-backed conditions and actions", async () => {
    const create = await createRule({
      name: "Chase big invoices",
      description: "Follow up when an invoice is overdue",
      trigger: "INVOICE_OVERDUE",
      conditions: { minTotal: 5000, customerTypes: ["COMMERCIAL"] },
      actions: [{ type: "CREATE_TASK", title: "Call about payment" }],
    });
    expect(create.statusCode).toBe(201);
    const created = create.json<{
      id: string;
      name: string;
      trigger: string;
      conditions: Record<string, unknown>;
      actions: Array<Record<string, unknown>>;
      enabled: boolean;
      runCount: number;
      lastRunAt: string | null;
    }>();
    expect(created.name).toBe("Chase big invoices");
    expect(created.trigger).toBe("INVOICE_OVERDUE");
    expect(created.conditions).toEqual({
      minTotal: 5000,
      customerTypes: ["COMMERCIAL"],
    });
    expect(created.actions).toHaveLength(1);
    expect(created.actions[0]?.type).toBe("CREATE_TASK");
    expect(created.actions[0]?.dueInHours).toBe(24);
    expect(created.enabled).toBe(true);
    expect(created.runCount).toBe(0);
    expect(created.lastRunAt).toBeNull();

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/automations?trigger=INVOICE_OVERDUE",
      headers: asAccount(),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<PageBody<unknown>>().data).toHaveLength(1);

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/automations/${created.id}`,
      headers: asAccount(),
    });
    expect(get.statusCode).toBe(200);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/automations/${created.id}`,
      headers: asAccount(),
      payload: { name: "Chase invoices", enabled: false },
    });
    expect(patch.statusCode).toBe(200);
    const patched = patch.json<{
      name: string;
      enabled: boolean;
      conditions: object;
    }>();
    expect(patched.name).toBe("Chase invoices");
    expect(patched.enabled).toBe(false);
    expect(patched.conditions).toEqual({
      minTotal: 5000,
      customerTypes: ["COMMERCIAL"],
    });

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/v1/automations/${created.id}`,
      headers: asAccount(),
    });
    expect(remove.statusCode).toBe(204);
    const gone = await app.inject({
      method: "GET",
      url: `/api/v1/automations/${created.id}`,
      headers: asAccount(),
    });
    expect(gone.statusCode).toBe(404);
  });

  it("requires an admin role for mutations", async () => {
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          userId: account.userId,
          workspaceId: account.workspaceId,
        },
      },
      data: { role: "MEMBER" },
    });

    const response = await createRule({
      name: "Member attempt",
      trigger: "JOB_CREATED",
      actions: [{ type: "ADD_TAG", tag: "vip" }],
    });
    expect(response.statusCode).toBe(403);

    const runDue = await app.inject({
      method: "POST",
      url: "/api/v1/automations/run-due",
      headers: asAccount(),
    });
    expect(runDue.statusCode).toBe(403);
  });

  it("keeps rules and runs tenant-scoped", async () => {
    const other = await registerAccount(app);
    const create = await createRule(
      {
        name: "Other workspace rule",
        trigger: "JOB_COMPLETED",
        actions: [{ type: "ADD_TAG", tag: "other" }],
      },
      other,
    );
    expect(create.statusCode).toBe(201);
    const created = create.json<{ id: string }>();

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/automations",
      headers: asAccount(),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<PageBody<unknown>>().data).toHaveLength(0);

    const foreignGet = await app.inject({
      method: "GET",
      url: `/api/v1/automations/${created.id}`,
      headers: asAccount(),
    });
    expect(foreignGet.statusCode).toBe(404);

    const foreignPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/automations/${created.id}`,
      headers: asAccount(),
      payload: { name: "Hijacked" },
    });
    expect(foreignPatch.statusCode).toBe(404);

    const foreignDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/automations/${created.id}`,
      headers: asAccount(),
    });
    expect(foreignDelete.statusCode).toBe(404);

    const runs = await listRuns();
    expect(runs.meta.total).toBe(0);
  });
});

describe("automation event handling", () => {
  it("runs a JOB_COMPLETED rule once, creating a task and a personalized message", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const job = await createJob(customer.id, location.id);

    const ruleResponse = await createRule({
      name: "Thank the customer",
      trigger: "JOB_COMPLETED",
      actions: [
        {
          type: "CREATE_TASK",
          title: "Follow up on the completed job",
          dueInHours: 12,
        },
        {
          type: "SEND_MESSAGE",
          channel: "SMS",
          intent: "FOLLOW_UP",
          body: "Hi {customer}, thanks for choosing {business} for {job}.",
        },
      ],
    });
    expect(ruleResponse.statusCode).toBe(201);
    const rule = ruleResponse.json<{ id: string }>();

    const event = {
      workspaceId: account.workspaceId,
      type: "JOB_COMPLETED" as const,
      entityType: "job" as const,
      entityId: job.id,
      actorId: account.userId,
      customerId: customer.id,
      jobId: job.id,
    };
    await emitEvent(event);

    const runs = await listRuns("?trigger=JOB_COMPLETED");
    expect(runs.meta.total).toBe(1);
    const run = runs.data[0];
    expect(run?.status).toBe("SUCCESS");
    expect(run?.entityId).toBe(job.id);
    expect(run?.detail).toContain("message");
    expect(run?.detail).toContain("task");

    const tasks = await listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Follow up on the completed job");

    const messages = await app.inject({
      method: "GET",
      url: `/api/v1/communications?customerId=${customer.id}`,
      headers: asAccount(),
    });
    expect(messages.statusCode).toBe(200);
    const messageRows =
      messages.json<
        PageBody<{ channel: string; intent: string; body: string | null }>
      >().data;
    expect(messageRows).toHaveLength(1);
    expect(messageRows[0]?.channel).toBe("SMS");
    expect(messageRows[0]?.intent).toBe("FOLLOW_UP");
    expect(messageRows[0]?.body).toContain(customer.name);
    expect(messageRows[0]?.body).toContain("Test Workspace");
    expect(messageRows[0]?.body).toContain("Deep clean");
    expect(messageRows[0]?.body).not.toContain("{customer}");

    const refreshed = await app.inject({
      method: "GET",
      url: `/api/v1/automations/${rule.id}`,
      headers: asAccount(),
    });
    const refreshedRule = refreshed.json<{
      runCount: number;
      lastRunAt: string | null;
    }>();
    expect(refreshedRule.runCount).toBe(1);
    expect(refreshedRule.lastRunAt).not.toBeNull();

    // Same rule + entity + trigger inside 24h is deduped.
    await emitEvent(event);
    const after = await listRuns("?trigger=JOB_COMPLETED");
    expect(after.meta.total).toBe(1);
  });

  it("records a SKIPPED run when conditions do not match and applies no actions", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const job = await createJob(customer.id, location.id, {
      priority: "NORMAL",
    });

    await createRule({
      name: "Urgent jobs only",
      trigger: "JOB_COMPLETED",
      conditions: { priorities: ["URGENT"] },
      actions: [{ type: "CREATE_TASK", title: "Call the customer" }],
    });

    await emitEvent({
      workspaceId: account.workspaceId,
      type: "JOB_COMPLETED",
      entityType: "job",
      entityId: job.id,
      actorId: account.userId,
      customerId: customer.id,
      jobId: job.id,
    });

    const runs = await listRuns("?status=SKIPPED");
    expect(runs.meta.total).toBe(1);
    expect(runs.data[0]?.detail).toContain("priority");
    expect(await listTasks()).toHaveLength(0);
  });

  it("makes run-due idempotent while sweeping overdue invoices", async () => {
    const customer = await createCustomer();
    const invoice = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: asAccount(),
      payload: {
        title: "Overdue maintenance",
        customerId: customer.id,
        status: "SENT",
        amount: 12_000,
        dueAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    });
    expect(invoice.statusCode).toBe(201);

    await createRule({
      name: "Chase overdue invoices",
      trigger: "INVOICE_OVERDUE",
      actions: [
        { type: "CREATE_TASK", title: "Call about the overdue invoice" },
      ],
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/automations/run-due",
      headers: asAccount(),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ evaluated: 1, run: 1 });

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/automations/run-due",
      headers: asAccount(),
    });
    expect(second.statusCode).toBe(200);
    // The invoice already ran within the dedupe window, so the sweep excludes
    // it before selecting candidates instead of re-evaluating a dead letter.
    expect(second.json()).toEqual({ evaluated: 0, run: 0 });

    const runs = await listRuns("?trigger=INVOICE_OVERDUE");
    expect(runs.meta.total).toBe(1);
    expect(runs.data[0]?.status).toBe("SUCCESS");

    const tasks = await listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Call about the overdue invoice");
  });

  it("sweeps past the oldest invoices once they have already run", async () => {
    const customer = await createCustomer();
    const ruleResponse = await createRule({
      name: "Chase overdue invoices",
      trigger: "INVOICE_OVERDUE",
      actions: [
        { type: "CREATE_TASK", title: "Call about the overdue invoice" },
      ],
    });
    expect(ruleResponse.statusCode).toBe(201);
    const rule = ruleResponse.json<{ id: string }>();

    const now = Date.now();
    await prisma.invoice.createMany({
      data: Array.from({ length: 201 }, (_, index) => ({
        workspaceId: account.workspaceId,
        number: `INV-BACKLOG-${index + 1}`,
        title: `Overdue ${index + 1}`,
        status: "SENT",
        customerId: customer.id,
        amount: 12_000,
        dueAt: new Date(
          now - (index === 200 ? 86_400_000 : 3 * 86_400_000) + index * 60_000,
        ),
      })),
    });

    const stored = await prisma.invoice.findMany({
      where: { workspaceId: account.workspaceId },
      select: { id: true },
      orderBy: { dueAt: "asc" },
    });
    expect(stored).toHaveLength(201);
    const backlog = stored.slice(0, 200);
    const newest = stored[200];
    expect(newest).toBeDefined();

    // The oldest 200 invoices already produced a run inside the dedupe window.
    // Without pre-filtering they would fill the sweep's 200-row limit forever.
    await prisma.automationRun.createMany({
      data: backlog.map((invoice) => ({
        workspaceId: account.workspaceId,
        ruleId: rule.id,
        trigger: "INVOICE_OVERDUE",
        status: "SUCCESS",
        entityType: "invoice",
        entityId: invoice.id,
      })),
    });

    const sweep = await app.inject({
      method: "POST",
      url: "/api/v1/automations/run-due",
      headers: asAccount(),
    });
    expect(sweep.statusCode).toBe(200);
    expect(sweep.json()).toEqual({ evaluated: 1, run: 1 });

    const runs = await prisma.automationRun.findMany({
      where: {
        workspaceId: account.workspaceId,
        trigger: "INVOICE_OVERDUE",
      },
      select: { entityId: true },
    });
    expect(runs).toHaveLength(201);
    expect(runs.some((run) => run.entityId === newest?.id)).toBe(true);
  });
});
