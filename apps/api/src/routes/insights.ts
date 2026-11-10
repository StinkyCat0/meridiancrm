import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ACTIVITY_TYPES,
  computeMomentum,
  type ActivityType,
  type DashboardSummary,
  type SearchHit,
  type SearchResponse,
  type StageBucket,
  type StageKind,
  type TrendPoint,
} from "@meridian/contracts";
import { authenticate, getAuth } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import { badRequest, likeTerm, notFound, parseOrThrow } from "../lib/http.js";
import { activityInclude, toActivity } from "./activities.js";
import { dealInclude, loadDealActivityStats, toDeal } from "./deals.js";

const DAY_MS = 86_400_000;

const dashboardQuerySchema = z.object({
  months: z.coerce.number().int().default(6),
});

const searchQuerySchema = z.object({
  q: z.string().trim().max(200),
});

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function insightRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/dashboard",
    {
      preHandler: authenticate,
      schema: {
        tags: ["insights"],
        summary: "Workspace dashboard summary",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { months: requestedMonths } = parseOrThrow(dashboardQuerySchema, request.query);
      const months = Math.min(12, Math.max(3, requestedMonths));
      const now = new Date();

      const workspace = await prisma.workspace.findUnique({
        where: { id: auth.workspaceId },
        select: { currency: true },
      });
      if (!workspace) throw notFound("Workspace");

      const monthStarts: Date[] = [];
      for (let index = months - 1; index >= 0; index -= 1) {
        monthStarts.push(
          new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1)),
        );
      }
      const trendStart = monthStarts[0] ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
      const cutoff = new Date(Math.min(trendStart.getTime(), ninetyDaysAgo.getTime()));

      const [openDeals, stageRows, trendDeals, mixRows, recentRows, taskRows] = await Promise.all([
        prisma.deal.findMany({
          where: { workspaceId: auth.workspaceId, stage: { kind: "OPEN" } },
          select: {
            id: true,
            value: true,
            stageId: true,
            stageChangedAt: true,
            expectedCloseDate: true,
            stage: { select: { kind: true, targetDays: true } },
          },
        }),
        prisma.stage.findMany({
          where: { pipeline: { workspaceId: auth.workspaceId } },
          select: { id: true, name: true, kind: true, pipelineId: true, order: true },
          orderBy: [{ pipelineId: "asc" }, { order: "asc" }],
        }),
        prisma.deal.findMany({
          where: {
            workspaceId: auth.workspaceId,
            OR: [{ createdAt: { gte: cutoff } }, { closedAt: { gte: cutoff } }],
          },
          select: {
            createdAt: true,
            closedAt: true,
            value: true,
            stage: { select: { kind: true } },
          },
        }),
        prisma.activity.groupBy({
          by: ["type"],
          where: { workspaceId: auth.workspaceId, createdAt: { gte: thirtyDaysAgo } },
          _count: { _all: true },
        }),
        prisma.deal.findMany({
          where: { workspaceId: auth.workspaceId },
          include: dealInclude,
          orderBy: { updatedAt: "desc" },
          take: 5,
        }),
        prisma.activity.findMany({
          where: {
            workspaceId: auth.workspaceId,
            type: "TASK",
            completedAt: null,
            dueAt: { not: null, lte: new Date(now.getTime() + 7 * DAY_MS) },
          },
          include: activityInclude,
          orderBy: { dueAt: "asc" },
          take: 5,
        }),
      ]);

      const activityStats = await loadDealActivityStats(
        auth.workspaceId,
        openDeals.map((deal) => deal.id),
        now,
      );

      const momentumCounts = { hot: 0, warm: 0, cold: 0 };
      const stageTotals = new Map<string, { count: number; value: number }>();
      let pipelineValue = 0;

      for (const deal of openDeals) {
        pipelineValue += deal.value;
        const bucket = stageTotals.get(deal.stageId) ?? { count: 0, value: 0 };
        bucket.count += 1;
        bucket.value += deal.value;
        stageTotals.set(deal.stageId, bucket);

        const stats = activityStats.get(deal.id);
        const momentum = computeMomentum({
          stageKind: deal.stage.kind as StageKind,
          stageAgeDays: Math.max(
            0,
            Math.floor((now.getTime() - deal.stageChangedAt.getTime()) / DAY_MS),
          ),
          stageTargetDays: deal.stage.targetDays,
          activityCount30d: stats?.count30d ?? 0,
          lastActivityDaysAgo: stats?.lastActivityAt
            ? Math.max(
                0,
                Math.floor((now.getTime() - stats.lastActivityAt.getTime()) / DAY_MS),
              )
            : null,
          expectedCloseDate: deal.expectedCloseDate,
          now,
        });
        momentumCounts[momentum.band] += 1;
      }

      const stageDistribution: StageBucket[] = stageRows.map((stage) => {
        const bucket = stageTotals.get(stage.id) ?? { count: 0, value: 0 };
        return {
          stageId: stage.id,
          stageName: stage.name,
          kind: stage.kind as StageKind,
          count: bucket.count,
          value: bucket.value,
        };
      });

      let wonValueThisMonth = 0;
      let wonCountThisMonth = 0;
      let wonLast90 = 0;
      let wonValueLast90 = 0;
      let lostLast90 = 0;
      const trend = new Map<string, TrendPoint>();
      for (const start of monthStarts) {
        trend.set(monthKey(start), { month: monthKey(start), won: 0, created: 0 });
      }

      for (const deal of trendDeals) {
        const kind = deal.stage.kind;
        if (deal.createdAt >= trendStart) {
          const point = trend.get(monthKey(deal.createdAt));
          if (point) point.created += 1;
        }
        if (!deal.closedAt) continue;

        if (kind === "WON" && deal.closedAt >= startOfMonth) {
          wonValueThisMonth += deal.value;
          wonCountThisMonth += 1;
        }
        if (deal.closedAt >= ninetyDaysAgo) {
          if (kind === "WON") {
            wonLast90 += 1;
            wonValueLast90 += deal.value;
          } else if (kind === "LOST") {
            lostLast90 += 1;
          }
        }
        if (kind === "WON") {
          const point = trend.get(monthKey(deal.closedAt));
          if (point) point.won += deal.value;
        }
      }

      const closedLast90 = wonLast90 + lostLast90;
      const winRate = closedLast90 === 0 ? 0 : Math.round((wonLast90 / closedLast90) * 100);
      const avgDealSize = wonLast90 === 0 ? 0 : Math.round(wonValueLast90 / wonLast90);

      const mixByType = new Map<string, number>();
      for (const row of mixRows) mixByType.set(row.type, row._count._all);
      const activityMix = ACTIVITY_TYPES.map((type) => ({
        type: type as ActivityType,
        count: mixByType.get(type) ?? 0,
      }));

      const recentStats = await loadDealActivityStats(
        auth.workspaceId,
        recentRows.map((deal) => deal.id),
        now,
      );

      const summary: DashboardSummary = {
        pipelineValue,
        openDealCount: openDeals.length,
        wonValueThisMonth,
        wonCountThisMonth,
        winRate,
        avgDealSize,
        revenueTrend: [...trend.values()],
        stageDistribution,
        activityMix,
        momentum: momentumCounts,
        recentDeals: recentRows.map((deal) => toDeal(deal, recentStats.get(deal.id), now)),
        tasksDue: taskRows.map(toActivity),
        currency: workspace.currency,
      };

      return summary;
    },
  );

  app.get(
    "/search",
    {
      preHandler: authenticate,
      schema: {
        tags: ["insights"],
        summary: "Search contacts, companies and deals",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<SearchResponse> => {
      const auth = getAuth(request);
      const { q } = parseOrThrow(searchQuerySchema, request.query);
      if (q.length < 2) throw badRequest("Search needs at least 2 characters");

      const term = likeTerm(q);
      const [contacts, companies, deals] = await Promise.all([
        prisma.contact.findMany({
          where: {
            workspaceId: auth.workspaceId,
            archived: false,
            OR: [
              { firstName: { contains: term } },
              { lastName: { contains: term } },
              { email: { contains: term } },
            ],
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            company: { select: { name: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 5,
        }),
        prisma.company.findMany({
          where: {
            workspaceId: auth.workspaceId,
            archived: false,
            OR: [{ name: { contains: term } }, { domain: { contains: term } }],
          },
          select: { id: true, name: true, domain: true, industry: true },
          orderBy: { updatedAt: "desc" },
          take: 5,
        }),
        prisma.deal.findMany({
          where: { workspaceId: auth.workspaceId, title: { contains: term } },
          select: {
            id: true,
            title: true,
            company: { select: { name: true } },
            stage: { select: { name: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 5,
        }),
      ]);

      const hits: SearchHit[] = [
        ...contacts.map((contact) => ({
          id: contact.id,
          type: "contact" as const,
          label: `${contact.firstName} ${contact.lastName}`,
          sublabel: contact.company?.name ?? contact.email,
          href: `/app/contacts/${contact.id}`,
        })),
        ...companies.map((company) => ({
          id: company.id,
          type: "company" as const,
          label: company.name,
          sublabel: company.industry ?? company.domain,
          href: `/app/companies/${company.id}`,
        })),
        ...deals.map((deal) => ({
          id: deal.id,
          type: "deal" as const,
          label: deal.title,
          sublabel: deal.company?.name ?? deal.stage.name,
          href: `/app/deals?deal=${deal.id}`,
        })),
      ];

      return { hits: hits.slice(0, 15), query: q };
    },
  );
}
