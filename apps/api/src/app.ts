import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import staticPlugin from "@fastify/static";
import { config } from "./config.js";
import { configureDatabase } from "./lib/db.js";
import { registerErrorHandler } from "./lib/http.js";
import { registerRoutes } from "./routes/index.js";

const STATIC_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const redactSensitiveUrl = (url: string): string =>
  url.replace(/\/invite\/[^/?#]+/gi, "/invite/[redacted]");

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export async function buildApp(
  options: { logger?: boolean } = {},
): Promise<FastifyInstance> {
  await configureDatabase();
  const app = Fastify({
    logger:
      options.logger ??
      (config.env === "test"
        ? false
        : {
            level: "info",
            transport: config.isProduction
              ? undefined
              : {
                  target: "pino-pretty",
                  options: { colorize: true, translateTime: "HH:MM:ss" },
                },
            serializers: {
              req: (request: {
                method?: string;
                url?: string;
                id?: string;
              }) => ({
                method: request.method,
                url: redactSensitiveUrl(request.url ?? ""),
                requestId: request.id,
              }),
            },
          }),
    genReqId(request) {
      const supplied = request.headers[REQUEST_ID_HEADER];
      if (typeof supplied === "string" && REQUEST_ID_PATTERN.test(supplied)) {
        return supplied;
      }
      return randomUUID();
    },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  app.decorateRequest("auth", null);
  registerErrorHandler(app);

  app.addHook("onRequest", async (request, reply) => {
    request.log = request.log.child({ requestId: request.id });
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/v1/auth"))
      reply.header("Cache-Control", "no-store");
    return payload;
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 600,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Try again shortly.",
      },
    }),
  });
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Meridian CRM API",
        description:
          "REST API for Meridian CRM. Multi-tenant, role-based, JSON over HTTPS. `Authorization: Bearer <access token>`.",
        version: "0.2.0",
      },
      servers: [{ url: "/api/v1", description: "Current deployment" }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
      tags: [
        { name: "auth", description: "Sessions and identity" },
        { name: "workspace", description: "Workspace, members, invites" },
        { name: "companies", description: "Company records" },
        { name: "contacts", description: "People" },
        { name: "deals", description: "Pipeline and revenue" },
        {
          name: "activities",
          description: "Calls, emails, meetings, notes, tasks",
        },
        { name: "pipelines", description: "Pipelines and stages" },
        { name: "insights", description: "Dashboard, search, audit" },
        {
          name: "communications",
          description: "Calls, texts, email and customer timeline",
        },
        {
          name: "dispatch",
          description: "Dispatch board, map and route planning",
        },
        { name: "finance", description: "Payments, expenses and margins" },
        { name: "automations", description: "Workflow rules and runs" },
        {
          name: "intelligence",
          description: "Explainable recommendations and forecasts",
        },
        { name: "team", description: "Technician performance and workload" },
        { name: "exports", description: "CSV exports for reconciliation" },
        {
          name: "public",
          description: "Unauthenticated server-to-server intake",
        },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  await app.register(registerRoutes, { prefix: "/api/v1" });

  if (config.serveWeb) {
    const webRoot = resolve(process.cwd(), config.webDistPath);
    if (!existsSync(resolve(webRoot, "index.html"))) {
      throw new Error(`SERVE_WEB=1 but no built web app at ${webRoot}`);
    }
    await app.register(staticPlugin, {
      root: webRoot,
      prefix: "/",
      cacheControl: false,
      setHeaders(response, filePath) {
        if (filePath.includes("/assets/")) {
          response.header(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
        } else {
          response.header("Cache-Control", "no-cache");
        }
        if (filePath.endsWith(".html")) {
          response.header("Content-Security-Policy", STATIC_CSP);
        }
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split("?")[0] ?? "";
      const looksLikeAsset =
        pathname.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(pathname);
      if (
        request.url.startsWith("/api/") ||
        request.url.startsWith("/docs") ||
        looksLikeAsset
      ) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Route not found" },
        });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.setNotFoundHandler((_request, reply) =>
      reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Route not found" },
      }),
    );
  }

  return app;
}
