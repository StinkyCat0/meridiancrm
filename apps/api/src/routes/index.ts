import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import { authRoutes } from "./auth.js";
import { workspaceRoutes } from "./workspace.js";
import { companyRoutes } from "./companies.js";
import { contactRoutes } from "./contacts.js";
import { dealRoutes } from "./deals.js";
import { pipelineRoutes } from "./pipelines.js";
import { activityRoutes } from "./activities.js";
import { insightRoutes } from "./insights.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", { schema: { hide: true } }, async (_request, reply) => {
    let database: "up" | "down" = "up";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "down";
    }
    return reply.status(database === "up" ? 200 : 503).send({
      status: database === "up" ? "ok" : "degraded",
      version: "0.1.0",
      uptime: Math.round(process.uptime()),
      database,
    });
  });

  await app.register(authRoutes);
  await app.register(workspaceRoutes);
  await app.register(companyRoutes);
  await app.register(contactRoutes);
  await app.register(dealRoutes);
  await app.register(pipelineRoutes);
  await app.register(activityRoutes);
  await app.register(insightRoutes);
}
