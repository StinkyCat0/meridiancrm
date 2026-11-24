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
  createTestApp,
  registerAccount,
  resetDatabase,
} from "../test/helpers.js";

const STUDIO_URL = "https://studio.example.test";
const STUDIO_TOKEN = "test-studio-service-token-0123456789abcdef";
const HANDOFF_CODE = "handoff-code-0123456789abcdef";
const mutableConfig = config as {
  websiteStudioUrl: string;
  websiteStudioToken: string;
};

const originalUrl = mutableConfig.websiteStudioUrl;
const originalToken = mutableConfig.websiteStudioToken;

let app: FastifyInstance;
let fetchMock: Mock;

const previewPayload = {
  websiteUserId: "website-user-1",
  email: "handoff-owner@example.com",
  name: "Handoff Owner",
  isVerified: true,
  crmAccess: true,
  expiresAt: "2026-11-23T00:01:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function preview() {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/website/handoff/preview",
    payload: { code: HANDOFF_CODE },
  });
}

function handoff() {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/website/handoff",
    payload: { code: HANDOFF_CODE },
  });
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
  mutableConfig.websiteStudioUrl = STUDIO_URL;
  mutableConfig.websiteStudioToken = STUDIO_TOKEN;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /auth/website/handoff/preview", () => {
  it("inspects the code through the website API", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(previewPayload));

    const response = await preview();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(previewPayload);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${STUDIO_URL}/api/studio/sso/inspect`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("x-meridian-studio-token")).toBe(
      STUDIO_TOKEN,
    );
    expect(response.body).not.toContain(STUDIO_TOKEN);
  });

  it("returns 503 when the website bridge is unconfigured", async () => {
    mutableConfig.websiteStudioToken = "";

    const response = await preview();

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("SERVICE_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /auth/website/handoff", () => {
  it("consumes the code, starts a CRM session, and audits the exchange", async () => {
    const account = await registerAccount(app, {
      email: previewPayload.email,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(previewPayload));

    const response = await handoff();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.user).toMatchObject({
      id: account.userId,
      email: account.email,
    });
    expect(body.workspace.id).toBe(account.workspaceId);
    expect(body.role).toBe("OWNER");
    expect(
      response.cookies.some((cookie) => cookie.name === "meridian_refresh"),
    ).toBe(true);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${STUDIO_URL}/api/studio/sso/consume`);

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(me.statusCode).toBe(200);

    const entry = await prisma.auditLog.findFirst({
      where: { action: "auth.website_handoff" },
    });
    expect(entry).toMatchObject({
      workspaceId: account.workspaceId,
      actorId: account.userId,
      entityType: "user",
      entityId: account.userId,
    });
    expect(JSON.parse(entry?.metadata ?? "{}")).toEqual({
      websiteUserId: previewPayload.websiteUserId,
    });
  });

  it("returns 401 for an invalid code", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401),
    );

    const response = await handoff();

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("returns 410 for an expired code", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "NOT_FOUND" } }, 410),
    );

    const response = await handoff();

    expect(response.statusCode).toBe(410);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 403 when the website account lost CRM access", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...previewPayload, crmAccess: false }),
    );

    const response = await handoff();

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
    expect(
      response.cookies.some((cookie) => cookie.name === "meridian_refresh"),
    ).toBe(false);
  });

  it("returns 503 when the website bridge is unconfigured", async () => {
    mutableConfig.websiteStudioUrl = "";

    const response = await handoff();

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("SERVICE_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
