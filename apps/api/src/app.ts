import Fastify, { type FastifyInstance } from "fastify";
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

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logger ??
      (config.env === "test"
        ? false
        : {
            level: "info",
            transport: config.isProduction
              ? undefined
              : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
            serializers: {
              req: (request: { method?: string; url?: string }) => ({
                method: request.method,
                url: redactSensitiveUrl(request.url ?? ""),
              }),
            },
          }),
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  app.decorateRequest("auth", null);
  registerErrorHandler(app);

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/v1/auth")) reply.header("Cache-Control", "no-store");
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
      error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly." },
    }),
  });
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Meridian CRM API",
        description:
          "REST API for Meridian CRM. Multi-tenant, role-based, JSON over HTTPS. `Authorization: Bearer <access token>`.",
        version: "0.1.0",
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
        { name: "activities", description: "Calls, emails, meetings, notes, tasks" },
        { name: "pipelines", description: "Pipelines and stages" },
        { name: "insights", description: "Dashboard, search, audit" },
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
          response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          response.setHeader("Cache-Control", "no-cache");
        }
        if (filePath.endsWith(".html")) {
          response.setHeader("Content-Security-Policy", STATIC_CSP);
        }
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split("?")[0] ?? "";
      const looksLikeAsset = pathname.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(pathname);
      if (request.url.startsWith("/api/") || request.url.startsWith("/docs") || looksLikeAsset) {
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
