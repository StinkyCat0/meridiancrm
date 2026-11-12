import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import {
  authHeaders,
  createTestApp,
  getDefaultStageId,
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

const createCompany = async (name: string) => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/companies",
    headers: authHeaders(account),
    payload: { name, industry: "Agency", tags: ["retainer"] },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
};

const createContact = async (firstName: string, companyId?: string) => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/contacts",
    headers: authHeaders(account),
    payload: {
      firstName,
      lastName: "Tester",
      email: `${firstName}@example.com`,
      companyId,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
};

describe("companies, contacts, and deals", () => {
  it("creates a company and contact with denormalized summaries", async () => {
    const company = await createCompany("Northwind Atelier");
    expect(company.contactCount).toBe(0);

    const contact = await createContact("Nora", company.id);
    expect(contact.company.name).toBe("Northwind Atelier");

    const companyResponse = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${company.id}`,
      headers: authHeaders(account),
    });
    expect(companyResponse.json().contactCount).toBe(1);
  });

  it("validates payloads and paginates deterministically", async () => {
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/companies",
      headers: authHeaders(account),
      payload: { name: "" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");

    for (const name of ["Alpha", "Bravo", "Charlie"]) await createCompany(name);
    const page = await app.inject({
      method: "GET",
      url: "/api/v1/companies?page=2&pageSize=2&sort=name&order=asc",
      headers: authHeaders(account),
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().meta).toMatchObject({
      page: 2,
      pageSize: 2,
      total: 3,
      totalPages: 2,
    });
    expect(page.json().data).toHaveLength(1);
  });

  it("archives and restores a company", async () => {
    const company = await createCompany("Archive Co");
    const archived = await app.inject({
      method: "DELETE",
      url: `/api/v1/companies/${company.id}`,
      headers: authHeaders(account),
    });
    expect(archived.statusCode).toBe(204);

    const active = await app.inject({
      method: "GET",
      url: "/api/v1/companies",
      headers: authHeaders(account),
    });
    expect(active.json().data).toHaveLength(0);

    const archivedList = await app.inject({
      method: "GET",
      url: "/api/v1/companies?archive=archived",
      headers: authHeaders(account),
    });
    expect(archivedList.json().data).toHaveLength(1);

    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/companies/${company.id}/restore`,
      headers: authHeaders(account),
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().archived).toBe(false);
  });
});

describe("pipeline behavior", () => {
  it("moves a deal through stages, records history, and closes it", async () => {
    const company = await createCompany("Cobalt & Co");
    const contact = await createContact("Casey", company.id);
    const stageId = await getDefaultStageId(account.workspaceId);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/deals",
      headers: authHeaders(account),
      payload: {
        title: "Retainer 2026",
        value: 4800000,
        currency: "USD",
        stageId,
        companyId: company.id,
        contactId: contact.id,
        expectedCloseDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      },
    });
    expect(created.statusCode).toBe(201);
    const deal = created.json();
    expect(deal.value).toBe(4800000);
    expect(deal.momentum.score).toBeGreaterThanOrEqual(0);
    expect(deal.momentum.breakdown).toHaveLength(4);

    const pipelines = await app.inject({
      method: "GET",
      url: "/api/v1/pipelines",
      headers: authHeaders(account),
    });
    const wonStage = pipelines
      .json()
      .flatMap(
        (pipeline: { stages: { id: string; kind: string }[] }) =>
          pipeline.stages,
      )
      .find((stage: { kind: string }) => stage.kind === "WON");
    expect(wonStage).toBeDefined();

    const moved = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${deal.id}/stage`,
      headers: authHeaders(account),
      payload: { stageId: wonStage.id },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().stage.kind).toBe("WON");
    expect(moved.json().closedAt).toEqual(expect.any(String));
    expect(moved.json().probability).toBe(100);

    const history = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${deal.id}/history`,
      headers: authHeaders(account),
    });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toHaveLength(2);
    expect(history.json()[0].stageName).toBe(wonStage.name ?? "Won");
    expect(history.json()[1].fromStageId).toBeNull();

    const openDeals = await app.inject({
      method: "GET",
      url: "/api/v1/deals?status=open",
      headers: authHeaders(account),
    });
    expect(openDeals.json().data).toHaveLength(0);
  });

  it("rejects a stage from another workspace", async () => {
    const other = await registerAccount(app, {
      email: "other-workspace@example.com",
    });
    const foreignStage = await getDefaultStageId(other.workspaceId);
    const stageId = await getDefaultStageId(account.workspaceId);

    const deal = await app.inject({
      method: "POST",
      url: "/api/v1/deals",
      headers: authHeaders(account),
      payload: { title: "Isolation check", value: 1000, stageId },
    });
    expect(deal.statusCode).toBe(201);

    const move = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${deal.json().id}/stage`,
      headers: authHeaders(account),
      payload: { stageId: foreignStage },
    });
    expect(move.statusCode).toBe(404);
  });

  it("retains stages referenced by history and reconciles kind changes", async () => {
    const pipelines = await app.inject({
      method: "GET",
      url: "/api/v1/pipelines",
      headers: authHeaders(account),
    });
    const stages = pipelines.json()[0].stages as {
      id: string;
      name: string;
      kind: string;
    }[];
    const proposal = stages.find((stage) => stage.name === "Proposal");
    const won = stages.find((stage) => stage.kind === "WON");
    const discovery = stages.find((stage) => stage.name === "Discovery");
    if (!proposal || !won || !discovery)
      throw new Error("default pipeline stages missing");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/deals",
      headers: authHeaders(account),
      payload: { title: "Kind sync", value: 250000, stageId: proposal.id },
    });
    expect(created.statusCode).toBe(201);
    const dealId = created.json().id;

    const flipClosed = await app.inject({
      method: "PATCH",
      url: `/api/v1/stages/${proposal.id}`,
      headers: authHeaders(account),
      payload: { kind: "WON" },
    });
    expect(flipClosed.statusCode).toBe(200);
    expect(flipClosed.json().kind).toBe("WON");

    const closedDeal = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${dealId}`,
      headers: authHeaders(account),
    });
    expect(closedDeal.json().closedAt).toEqual(expect.any(String));

    const flipOpen = await app.inject({
      method: "PATCH",
      url: `/api/v1/stages/${proposal.id}`,
      headers: authHeaders(account),
      payload: { kind: "OPEN" },
    });
    expect(flipOpen.statusCode).toBe(200);
    const reopened = await app.inject({
      method: "GET",
      url: `/api/v1/deals/${dealId}`,
      headers: authHeaders(account),
    });
    expect(reopened.json().closedAt).toBeNull();

    // Move the deal out so Discovery is not "in use" by current deals, then delete it.
    const moved = await app.inject({
      method: "PATCH",
      url: `/api/v1/deals/${dealId}/stage`,
      headers: authHeaders(account),
      payload: { stageId: won.id },
    });
    expect(moved.statusCode).toBe(200);

    const deleteWithHistory = await app.inject({
      method: "DELETE",
      url: `/api/v1/stages/${proposal.id}`,
      headers: authHeaders(account),
    });
    expect(deleteWithHistory.statusCode).toBe(409);
    expect(deleteWithHistory.json().error.code).toBe("CONFLICT");
  });
});

describe("activities, dashboard, and search", () => {
  it("logs activities and surfaces them in dashboard and search", async () => {
    const company = await createCompany("Fable House");
    const activity = await app.inject({
      method: "POST",
      url: "/api/v1/activities",
      headers: authHeaders(account),
      payload: {
        type: "TASK",
        title: "Send proposal",
        companyId: company.id,
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(activity.statusCode).toBe(201);

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard?months=6",
      headers: authHeaders(account),
    });
    expect(dashboard.statusCode).toBe(200);
    const summary = dashboard.json();
    expect(summary.currency).toBe("USD");
    expect(summary.revenueTrend).toHaveLength(6);
    expect(summary.tasksDue[0].title).toBe("Send proposal");
    expect(summary.activityMix).toEqual(expect.any(Array));

    const search = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=Fable",
      headers: authHeaders(account),
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().hits[0]).toMatchObject({
      type: "company",
      label: "Fable House",
    });

    const short = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=F",
      headers: authHeaders(account),
    });
    expect(short.statusCode).toBe(400);
  });
});
