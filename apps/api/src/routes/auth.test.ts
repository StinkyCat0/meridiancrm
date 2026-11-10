import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import { authHeaders, createTestApp, registerAccount, resetDatabase } from "../test/helpers.js";

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

const refreshCookie = (response: { cookies: { name: string; value: string }[] }) => {
  const cookie = response.cookies.find((candidate) => candidate.name === "meridian_refresh");
  if (!cookie) throw new Error("refresh cookie missing");
  return `meridian_refresh=${cookie.value}`;
};

describe("registration and identity", () => {
  it("creates a workspace, returns a session, and resolves /auth/me", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        name: "Avery Stone",
        email: "Avery@Example.com",
        password: "Meridian1234",
        workspaceName: "Stone Atelier",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.user.email).toBe("avery@example.com");
    expect(body.workspace.name).toBe("Stone Atelier");
    expect(body.role).toBe("OWNER");
    expect(response.headers["set-cookie"]).toBeDefined();
    expect(response.cookies.some((cookie) => cookie.name === "meridian_refresh")).toBe(true);

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: authHeaders({
        accessToken: body.accessToken,
        userId: body.user.id,
        workspaceId: body.workspace.id,
        email: body.user.email,
      }),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().members).toBe(1);
  });

  it("rejects duplicate emails and weak passwords", async () => {
    await registerAccount(app, { email: "dupe@example.com" });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        name: "Second Person",
        email: "dupe@example.com",
        password: "Meridian1234",
        workspaceName: "Second Studio",
      },
    });
    expect(duplicate.statusCode).toBe(409);

    const weak = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        name: "Weak Person",
        email: "weak@example.com",
        password: "short",
        workspaceName: "Weak Studio",
      },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("sessions", () => {
  it("logs in, rotates refresh tokens, and rejects a reused refresh token", async () => {
    const account = await registerAccount(app, { email: "session@example.com" });

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: account.email, password: "TestPassword123" },
    });
    expect(login.statusCode).toBe(200);
    const firstCookie = refreshCookie(login);

    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: account.email, password: "WrongPassword123" },
    });
    expect(wrong.statusCode).toBe(401);

    const refreshed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: firstCookie },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().accessToken).toEqual(expect.any(String));
    const secondCookie = refreshCookie(refreshed);
    expect(secondCookie).not.toBe(firstCookie);

    const reuse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: firstCookie },
    });
    expect(reuse.statusCode).toBe(401);

    // Presenting a consumed token revokes the whole family, including the rotated session.
    const afterReuse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: secondCookie },
    });
    expect(afterReuse.statusCode).toBe(401);
  });

  it("revokes the refresh token on logout", async () => {
    await registerAccount(app, { email: "logout@example.com" });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "logout@example.com", password: "TestPassword123" },
    });
    const cookie = refreshCookie(login);

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);

    const refreshed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie },
    });
    expect(refreshed.statusCode).toBe(401);
  });

  it("rejects a malformed bearer token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("tenancy and roles", () => {
  it("isolates workspaces by returning 404 across tenants", async () => {
    const first = await registerAccount(app, { email: "first@example.com" });
    const second = await registerAccount(app, { email: "second@example.com" });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/companies",
      headers: authHeaders(first),
      payload: { name: "Private Client" },
    });
    expect(created.statusCode).toBe(201);
    const companyId = created.json().id;

    const peek = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyId}`,
      headers: authHeaders(second),
    });
    expect(peek.statusCode).toBe(404);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/companies",
      headers: authHeaders(second),
    });
    expect(list.json().data).toHaveLength(0);
  });

  it("enforces admin-only workspace mutations for invited members", async () => {
    const owner = await registerAccount(app, { email: "owner@example.com" });
    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/workspace/invites",
      headers: authHeaders(owner),
      payload: { email: "member@example.com", role: "MEMBER" },
    });
    expect(invite.statusCode).toBe(201);
    const token = invite.json().token as string;

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/auth/accept-invite",
      payload: { token, name: "Invited Member", password: "MemberPassword123" },
    });
    expect(accepted.statusCode).toBe(201);
    const member = {
      accessToken: accepted.json().accessToken as string,
      userId: accepted.json().user.id as string,
      workspaceId: accepted.json().workspace.id as string,
      email: "member@example.com",
    };

    const patchWorkspace = await app.inject({
      method: "PATCH",
      url: "/api/v1/workspace",
      headers: authHeaders(member),
      payload: { name: "Hijacked" },
    });
    expect(patchWorkspace.statusCode).toBe(403);

    const createInvite = await app.inject({
      method: "POST",
      url: "/api/v1/workspace/invites",
      headers: authHeaders(member),
      payload: { email: "other@example.com", role: "MEMBER" },
    });
    expect(createInvite.statusCode).toBe(403);

    const members = await app.inject({
      method: "GET",
      url: "/api/v1/workspace/members",
      headers: authHeaders(member),
    });
    expect(members.statusCode).toBe(200);
    expect(members.json()).toHaveLength(2);

    const reaccept = await app.inject({
      method: "POST",
      url: "/api/v1/auth/accept-invite",
      payload: { token, name: "Duplicate Member", password: "MemberPassword123" },
    });
    expect([409, 410]).toContain(reaccept.statusCode);
  });
});
