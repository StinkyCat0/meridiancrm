import type { FastifyInstance } from "fastify";
import {
  intelligenceQuerySchema,
  type AssistantBrief,
  type IntelligenceSummary,
  type Recommendation,
} from "@meridian/contracts";
import { authenticate, getAuth } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import { notFound, parseOrThrow } from "../lib/http.js";
import {
  buildAssistantBrief,
  buildIntelligenceSummary,
  filterRecommendations,
} from "../lib/intelligence.js";

export async function intelligenceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/intelligence/summary",
    {
      preHandler: authenticate,
      schema: {
        tags: ["intelligence"],
        summary: "Explainable workspace intelligence and recommendations",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<IntelligenceSummary> => {
      const auth = getAuth(request);
      return buildIntelligenceSummary(auth.workspaceId);
    },
  );

  app.get(
    "/intelligence/recommendations",
    {
      preHandler: authenticate,
      schema: {
        tags: ["intelligence"],
        summary: "Filtered recommendation feed",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<Recommendation[]> => {
      const auth = getAuth(request);
      const query = parseOrThrow(intelligenceQuerySchema, request.query);
      const summary = await buildIntelligenceSummary(auth.workspaceId);
      return filterRecommendations(summary.recommendations, query);
    },
  );

  app.get(
    "/intelligence/brief",
    {
      preHandler: authenticate,
      schema: {
        tags: ["intelligence"],
        summary: "Assistant brief derived from the current summary",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<AssistantBrief> => {
      const auth = getAuth(request);
      const [summary, workspace] = await Promise.all([
        buildIntelligenceSummary(auth.workspaceId),
        prisma.workspace.findUnique({
          where: { id: auth.workspaceId },
          select: { currency: true },
        }),
      ]);
      if (!workspace) throw notFound("Workspace");
      return buildAssistantBrief(summary, workspace.currency);
    },
  );
}
