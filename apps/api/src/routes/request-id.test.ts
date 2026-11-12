import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

const REQUEST_ID_HEADER = "x-request-id";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
});

afterAll(async () => {
  await app.close();
});

describe("request id propagation", () => {
  it("echoes a valid supplied request id", async () => {
    const requestId = "req-0123456789abcdef";
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { [REQUEST_ID_HEADER]: requestId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers[REQUEST_ID_HEADER]).toBe(requestId);
  });

  it("generates a uuid when the header is missing", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
    });

    expect(response.headers[REQUEST_ID_HEADER]).toMatch(UUID_PATTERN);
  });

  it("replaces a malformed request id with a uuid", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { [REQUEST_ID_HEADER]: "not a valid id!" },
    });

    const requestId = response.headers[REQUEST_ID_HEADER];
    expect(typeof requestId).toBe("string");
    expect(requestId).not.toBe("not a valid id!");
    expect(requestId).toMatch(UUID_PATTERN);
  });

  it("replaces an oversized request id with a uuid", async () => {
    const oversized = "a".repeat(129);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { [REQUEST_ID_HEADER]: oversized },
    });

    const requestId = response.headers[REQUEST_ID_HEADER];
    expect(requestId).not.toBe(oversized);
    expect(requestId).toMatch(UUID_PATTERN);
  });

  it("echoes the request id on 404 responses", async () => {
    const requestId = "missing-route-request";
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/does-not-exist",
      headers: { [REQUEST_ID_HEADER]: requestId },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers[REQUEST_ID_HEADER]).toBe(requestId);
  });

  it("echoes the request id on validation errors", async () => {
    const requestId = "validation-error-request";
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { [REQUEST_ID_HEADER]: requestId },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers[REQUEST_ID_HEADER]).toBe(requestId);
  });
});
