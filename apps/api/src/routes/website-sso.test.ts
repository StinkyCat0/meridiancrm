import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { config } from "../config.js";
import { prisma } from "../lib/db.js";
import { WebsiteSsoError, verifyWebsiteToken } from "../lib/website-sso.js";
import {
  createTestApp,
  registerAccount,
  resetDatabase,
} from "../test/helpers.js";

const WEBSITE_ISSUER = "meridian-website";
const WEBSITE_AUDIENCE = "meridian-crm";

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

async function mintToken(
  user: Record<string, unknown>,
  options: {
    secret?: string;
    issuer?: string;
    audience?: string;
    subject?: string | null;
    expiresIn?: string | null;
  } = {},
): Promise<string> {
  const jwt = new SignJWT({ user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(options.issuer ?? WEBSITE_ISSUER)
    .setAudience(options.audience ?? WEBSITE_AUDIENCE)
    .setIssuedAt();
  if (options.expiresIn !== null) {
    jwt.setExpirationTime(options.expiresIn ?? "5m");
  }
  if (options.subject !== null) {
    jwt.setSubject(options.subject ?? `website-${crypto.randomUUID()}`);
  }
  return jwt.sign(
    new TextEncoder().encode(options.secret ?? config.websiteJwtSecret),
  );
}

function websiteClaims(
  email: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `website-${crypto.randomUUID()}`,
    email,
    isVerified: true,
    crmAccess: true,
    role: "MEMBER",
    ...overrides,
  };
}

function exchange(token: string) {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/website",
    payload: { token },
  });
}

describe("POST /auth/website", () => {
  it("exchanges a verified website session for the local owner session", async () => {
    const account = await registerAccount(app, {
      email: "website-owner@example.com",
    });
    const token = await mintToken(websiteClaims(account.email.toUpperCase()));

    const response = await exchange(token);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.expiresIn).toBe(config.accessTokenTtl);
    expect(body.user).toMatchObject({
      id: account.userId,
      email: account.email,
    });
    expect(body.workspace.id).toBe(account.workspaceId);
    expect(body.role).toBe("OWNER");
    expect(body).not.toHaveProperty("refreshToken");
    expect(
      response.cookies.some((cookie) => cookie.name === "meridian_refresh"),
    ).toBe(true);

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().role).toBe("OWNER");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = await mintToken(websiteClaims("someone@example.com"), {
      secret: "different-website-secret-that-is-long-enough-for-hs256",
    });

    const response = await exchange(token);

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
    expect(response.body).not.toContain(token);
  });

  it("rejects a correctly signed token without an exp claim", async () => {
    const token = await mintToken(websiteClaims("no-exp@example.com"), {
      expiresIn: null,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/website",
      remoteAddress: "203.0.113.11",
      payload: { token },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a token from the wrong issuer", async () => {
    const token = await mintToken(websiteClaims("someone@example.com"), {
      issuer: "meridian-somewhere-else",
    });

    const response = await exchange(token);

    expect(response.statusCode).toBe(401);
  });

  it("rejects a token without crmAccess", async () => {
    const account = await registerAccount(app, {
      email: "no-crm-claim@example.com",
    });
    const user = websiteClaims(account.email);
    delete user.crmAccess;

    const response = await exchange(await mintToken(user));

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
  });

  it("rejects a token whose crmAccess is false", async () => {
    const account = await registerAccount(app, {
      email: "crm-denied@example.com",
    });
    const token = await mintToken(
      websiteClaims(account.email, { crmAccess: false }),
    );

    const response = await exchange(token);

    expect(response.statusCode).toBe(403);
  });

  it("rejects an unverified website account", async () => {
    const account = await registerAccount(app, {
      email: "unverified@example.com",
    });
    const token = await mintToken(
      websiteClaims(account.email, { isVerified: false }),
    );

    const response = await exchange(token);

    expect(response.statusCode).toBe(403);
  });

  it("rejects an email that has no CRM account", async () => {
    const token = await mintToken(websiteClaims("unknown@example.com"));

    const response = await exchange(token);

    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe(
      "This website account is not linked to a CRM workspace",
    );
  });

  it("rejects a CRM user without a workspace membership", async () => {
    const email = `orphan-${crypto.randomUUID()}@example.com`;
    await prisma.user.create({
      data: { email, name: "Orphan User", passwordHash: "unused" },
    });

    const response = await exchange(await mintToken(websiteClaims(email)));

    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe(
      "This website account is not linked to a CRM workspace",
    );
  });

  it("rejects an empty body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/website",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns SERVICE_UNAVAILABLE when website SSO is not configured", async () => {
    const mutableConfig = config as { websiteJwtSecret: string };
    const original = mutableConfig.websiteJwtSecret;
    mutableConfig.websiteJwtSecret = "";
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/website",
        remoteAddress: "203.0.113.10",
        payload: { token: "x".repeat(20) },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("SERVICE_UNAVAILABLE");
      expect(response.json().error.message).toBe(
        "Website SSO is not configured",
      );
    } finally {
      mutableConfig.websiteJwtSecret = original;
    }
  });
});

describe("verifyWebsiteToken", () => {
  it("returns narrowed claims for a valid website token", async () => {
    const token = await mintToken(websiteClaims("verified@example.com"), {
      subject: "website-user-42",
    });

    await expect(
      verifyWebsiteToken(token, config.websiteJwtSecret),
    ).resolves.toEqual({
      email: "verified@example.com",
      verified: true,
      crmAccess: true,
      websiteUserId: "website-user-42",
    });
  });

  it("falls back to user.id when the subject is absent", async () => {
    const user = websiteClaims("no-subject@example.com");
    const token = await mintToken(user, { subject: null });

    const claims = await verifyWebsiteToken(token, config.websiteJwtSecret);

    expect(claims.websiteUserId).toBe(user.id);
  });

  it("rejects an empty or short secret as unconfigured", async () => {
    const token = await mintToken(websiteClaims("verified@example.com"));

    await expect(verifyWebsiteToken(token, "")).rejects.toMatchObject({
      name: "WebsiteSsoError",
      reason: "unconfigured",
    });
    await expect(verifyWebsiteToken(token, "too-short")).rejects.toBeInstanceOf(
      WebsiteSsoError,
    );
    await expect(verifyWebsiteToken(token, "too-short")).rejects.toMatchObject({
      reason: "unconfigured",
    });
  });
});
