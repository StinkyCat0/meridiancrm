import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { prisma } from "../lib/db.js";
import {
  createTestApp,
  registerAccount,
  resetDatabase,
  type TestAccount,
} from "../test/helpers.js";

let app: FastifyInstance;
let account: TestAccount;

const intakeSecret = config.websiteIntakeSecret;
const intakeSlug = config.websiteIntakeWorkspaceSlug;

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

  await prisma.workspace.update({
    where: { id: account.workspaceId },
    data: { slug: intakeSlug },
  });

  const pipeline = await prisma.pipeline.findFirst({
    where: { workspaceId: account.workspaceId },
  });
  if (!pipeline) {
    await prisma.pipeline.create({
      data: {
        workspaceId: account.workspaceId,
        name: "Growth",
        isDefault: true,
        stages: { create: [{ name: "Discovery", order: 0, kind: "OPEN" }] },
      },
    });
  }
});

const validPayload = {
  name: "Website Visitor",
  email: "visitor@example.com",
  subject: "Bathroom remodel",
  message: "I would like a quote for a bathroom remodel.",
};

function submit(
  payload: Record<string, unknown> = validPayload,
  secret: string = intakeSecret,
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/public/intake",
    headers: { "x-meridian-intake-secret": secret },
    payload,
  });
}

async function defaultPipeline() {
  return prisma.pipeline.findFirstOrThrow({
    where: { workspaceId: account.workspaceId, isDefault: true },
    include: {
      stages: {
        where: { kind: "OPEN" },
        orderBy: { order: "asc" },
        take: 1,
      },
    },
  });
}

describe("POST /public/intake", () => {
  it("rejects a wrong intake secret", async () => {
    const response = await submit(validPayload, "not-the-right-secret");

    expect(response.statusCode).toBe(401);
    expect(await prisma.deal.count()).toBe(0);
    expect(await prisma.contact.count()).toBe(0);
  });

  it("creates a deal for a valid submission", async () => {
    const response = await submit();

    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string };
    expect(typeof body.id).toBe("string");

    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(deal.workspaceId).toBe(account.workspaceId);

    const history = await prisma.stageHistory.findMany({
      where: { dealId: deal.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.fromStageId).toBeNull();
    expect(history[0]?.changedById).toBeNull();
  });

  it("reuses the contact on a second submission with the same email", async () => {
    const first = await submit();
    const second = await submit({ ...validPayload, name: "Same Visitor" });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const contacts = await prisma.contact.findMany({
      where: {
        workspaceId: account.workspaceId,
        email: validPayload.email,
      },
    });
    expect(contacts).toHaveLength(1);

    const contact = contacts[0];
    if (!contact) throw new Error("contact was not created");

    const deals = await prisma.deal.findMany({
      where: { workspaceId: account.workspaceId },
    });
    expect(deals).toHaveLength(2);
    expect(deals.every((deal) => deal.contactId === contact.id)).toBe(true);
  });

  it("reuses a contact whose stored email has different casing", async () => {
    const existing = await prisma.contact.create({
      data: {
        workspaceId: account.workspaceId,
        firstName: "Ada",
        lastName: "Lovelace",
        email: "Ada@Example.com",
      },
    });

    const response = await submit({
      ...validPayload,
      email: "ada@example.com",
    });
    expect(response.statusCode).toBe(201);
    const { id } = response.json() as { id: string };

    const deal = await prisma.deal.findUniqueOrThrow({ where: { id } });
    expect(deal.contactId).toBe(existing.id);
    expect(
      await prisma.contact.count({
        where: { workspaceId: account.workspaceId },
      }),
    ).toBe(1);
  });

  it("places the deal in the default pipeline's first open stage", async () => {
    const response = await submit();
    expect(response.statusCode).toBe(201);
    const { id } = response.json() as { id: string };

    const pipeline = await defaultPipeline();
    const stage = pipeline.stages[0];
    if (!stage) throw new Error("default pipeline has no open stage");
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id } });

    expect(deal.pipelineId).toBe(pipeline.id);
    expect(deal.stageId).toBe(stage.id);
  });

  it("records an inbound communication linked to the contact", async () => {
    const response = await submit();
    expect(response.statusCode).toBe(201);
    const { id } = response.json() as { id: string };

    const deal = await prisma.deal.findUniqueOrThrow({ where: { id } });
    const communication = await prisma.communication.findFirstOrThrow({
      where: {
        workspaceId: account.workspaceId,
        contactId: deal.contactId,
      },
    });

    expect(communication.channel).toBe("EMAIL");
    expect(communication.direction).toBe("INBOUND");
    expect(communication.status).toBe("RECEIVED");
    expect(communication.provider).toBe("website");
    expect(communication.body).toBe(validPayload.message);
    expect(communication.contactId).toBe(deal.contactId);
  });

  it("treats a blank subject as absent", async () => {
    const response = await submit({ ...validPayload, subject: "   " });
    expect(response.statusCode).toBe(201);
    const { id } = response.json() as { id: string };

    const deal = await prisma.deal.findUniqueOrThrow({ where: { id } });
    const communication = await prisma.communication.findFirstOrThrow({
      where: {
        workspaceId: account.workspaceId,
        contactId: deal.contactId,
      },
    });

    expect(deal.title).toBe("Website inquiry");
    expect(communication.subject).toBeNull();
  });

  it("rejects an empty message", async () => {
    const response = await submit({ ...validPayload, message: "" });

    expect(response.statusCode).toBe(400);
    expect(await prisma.deal.count()).toBe(0);
  });

  it("returns SERVICE_UNAVAILABLE when the intake workspace is missing", async () => {
    await prisma.workspace.update({
      where: { id: account.workspaceId },
      data: { slug: "workspace-without-intake" },
    });

    const response = await submit();
    const body = response.json() as { error: { code: string } };

    expect(response.statusCode).toBe(503);
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(await prisma.deal.count()).toBe(0);
  });
});
