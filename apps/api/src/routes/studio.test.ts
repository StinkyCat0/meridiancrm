import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { prisma } from "../lib/db.js";
import {
  authHeaders,
  createTestApp,
  registerAccount,
  resetDatabase,
  type TestAccount,
} from "../test/helpers.js";

const STUDIO_URL = "https://studio.example.test";
const STUDIO_TOKEN = "test-studio-service-token-0123456789abcdef";
const mutableConfig = config as {
  websiteStudioUrl: string;
  websiteStudioToken: string;
};

const originalUrl = mutableConfig.websiteStudioUrl;
const originalToken = mutableConfig.websiteStudioToken;

let app: FastifyInstance;
let account: TestAccount;
let fetchMock: Mock;

const accountPayload = {
  id: "website-account-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "user",
  isVerified: true,
  isActive: true,
  access: {
    canLogin: true,
    canAccessChat: true,
    canAccessPremiumFeatures: true,
    canAccessCrm: true,
  },
  subscription: {
    plan: "pro",
    status: "active",
    currentPeriodEnd: "2027-01-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
  },
  avatar: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastLogin: "2026-11-20T00:00:00.000Z",
};

const overviewPayload = {
  generatedAt: "2026-11-23T00:00:00.000Z",
  accounts: { total: 3, verified: 2, crmAccess: 1, active: 2, admins: 1 },
  subscriptions: { free: 1, basic: 0, pro: 2, enterprise: 0, pastDue: 0 },
  inquiries: { total: 4, new: 1, read: 2, archived: 1, last7Days: 2 },
  chat: { rooms: 2, messages: 12, messages7Days: 5 },
  demos: [
    { key: "bakery", name: "The Daily Knead", path: "/bakery", visits: 7 },
  ],
  integrations: {
    mongo: "up",
    email: "enabled",
    crmIntake: "configured",
    crmHandoff: "configured",
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function request(method: string, url: string, payload?: unknown) {
  const options = {
    method: method as "GET" | "PATCH" | "POST" | "DELETE",
    url: `/api/v1${url}`,
    headers: authHeaders(account),
  };
  return payload === undefined
    ? app.inject(options)
    : app.inject({ ...options, payload: payload as object });
}

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  mutableConfig.websiteStudioUrl = originalUrl;
  mutableConfig.websiteStudioToken = originalToken;
});

beforeEach(async () => {
  await resetDatabase();
  account = await registerAccount(app);
  mutableConfig.websiteStudioUrl = STUDIO_URL;
  mutableConfig.websiteStudioToken = STUDIO_TOKEN;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /studio/overview", () => {
  it("proxies the website overview without exposing the service token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(overviewPayload));

    const response = await request("GET", "/studio/overview");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      generatedAt: overviewPayload.generatedAt,
      accounts: { total: 3 },
      integrations: { mongo: "up" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${STUDIO_URL}/api/studio/overview`);
    expect(new Headers(init.headers).get("x-meridian-studio-token")).toBe(
      STUDIO_TOKEN,
    );
    expect(response.body).not.toContain(STUDIO_TOKEN);
    expect(response.headers["x-meridian-studio-token"]).toBeUndefined();
  });

  it("returns 503 when the website Studio bridge is unconfigured", async () => {
    mutableConfig.websiteStudioToken = "";

    const response = await request("GET", "/studio/overview");

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("SERVICE_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects members with 403 before calling the website", async () => {
    await prisma.membership.updateMany({
      where: { userId: account.userId },
      data: { role: "MEMBER" },
    });

    const response = await request("GET", "/studio/overview");

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /studio/accounts/:id", () => {
  it("proxies the update and audits the write", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ account: { ...accountPayload, isActive: false } }),
    );

    const response = await request(
      "PATCH",
      "/studio/accounts/website-account-1",
      { isActive: false, canAccessCrm: true },
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().account.isActive).toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${STUDIO_URL}/api/studio/accounts/website-account-1`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      isActive: false,
      canAccessCrm: true,
    });

    const entry = await prisma.auditLog.findFirst({
      where: { action: "studio.account_updated" },
    });
    expect(entry).toMatchObject({
      workspaceId: account.workspaceId,
      actorId: account.userId,
      entityType: "studio_account",
      entityId: "website-account-1",
    });
    const metadata = JSON.parse(entry?.metadata ?? "{}") as {
      fields: string[];
    };
    expect(metadata.fields.sort()).toEqual(["canAccessCrm", "isActive"]);
  });
});

describe("POST /studio/chat/rooms/:id/messages", () => {
  it("passes the signed-in CRM email as authorEmail", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        message: {
          id: "message-1",
          roomId: "room-1",
          content: "Hello from the CRM",
          author: { id: "a", name: "Test Owner", avatar: null, role: "admin" },
          parentId: null,
          attachments: [],
          reactions: [],
          edited: false,
          createdAt: "2026-11-23T00:00:00.000Z",
          replies: [],
          replyCount: 0,
        },
      }),
    );

    const response = await request(
      "POST",
      "/studio/chat/rooms/room-1/messages",
      { content: "Hello from the CRM" },
    );

    expect(response.statusCode).toBe(201);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      content: "Hello from the CRM",
      authorEmail: account.email,
    });
    const entry = await prisma.auditLog.findFirst({
      where: { action: "studio.chat_message_posted" },
    });
    expect(entry?.entityId).toBe("message-1");
  });
});

describe("Studio upstream failures", () => {
  it("maps a website 5xx to 502 BAD_GATEWAY", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("upstream exploded", { status: 500 }),
    );

    const response = await request("GET", "/studio/overview");

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("BAD_GATEWAY");
  });

  it("maps a network failure to 502 BAD_GATEWAY", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("socket hang up"));

    const response = await request("GET", "/studio/overview");

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("BAD_GATEWAY");
  });
});
