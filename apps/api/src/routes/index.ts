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
import { locationRoutes } from "./locations.js";
import { serviceRoutes } from "./services.js";
import { jobRoutes } from "./jobs.js";
import { estimateRoutes } from "./estimates.js";
import { invoiceRoutes } from "./invoices.js";
import { opsRoutes } from "./ops.js";
import { communicationsRoutes } from "./communications.js";
import { timelineRoutes } from "./timeline.js";
import { dispatchRoutes } from "./dispatch.js";
import { financeRoutes } from "./finance.js";
import { automationRoutes } from "./automations.js";
import { intelligenceRoutes } from "./intelligence.js";
import { teamRoutes } from "./team.js";

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
  await app.register(locationRoutes);
  await app.register(serviceRoutes);
  await app.register(jobRoutes);
  await app.register(estimateRoutes);
  await app.register(invoiceRoutes);
  await app.register(opsRoutes);
  await app.register(communicationsRoutes);
  await app.register(timelineRoutes);
  await app.register(dispatchRoutes);
  await app.register(financeRoutes);
  await app.register(automationRoutes);
  await app.register(intelligenceRoutes);
  await app.register(teamRoutes);
}
