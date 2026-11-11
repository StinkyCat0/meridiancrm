import type { FastifyInstance } from "fastify";
import { opsQuerySchema, type OpsSummary } from "@meridian/contracts";
import { authenticate, getAuth } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import { badRequest, notFound, parseOrThrow } from "../lib/http.js";
import { jobInclude, toJob } from "./jobs.js";

const DAY_MS = 86_400_000;

function dayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDay(value: string | undefined): Date {
  if (!value) return dayStart(new Date());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw badRequest("Use a YYYY-MM-DD date");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  // Date.UTC rolls invalid values over (Feb 31 becomes Mar 3), so round-trip.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw badRequest("Use a valid calendar date");
  }
  return date;
}

export async function opsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/ops/summary",
    {
      preHandler: authenticate,
      schema: {
        tags: ["operations"],
        summary: "Today's schedule, revenue and receivables",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<OpsSummary> => {
      const auth = getAuth(request);
      const query = parseOrThrow(opsQuerySchema, request.query);
      const start = parseDay(query.date);
      const end = new Date(start.getTime() + DAY_MS);
      const now = new Date();
      const weekEnd = new Date(Math.max(now.getTime(), start.getTime()) + 7 * DAY_MS);
      const openStatuses = ["UNSCHEDULED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS"];

      const workspace = await prisma.workspace.findUnique({
        where: { id: auth.workspaceId },
        select: { currency: true },
      });
      if (!workspace) throw notFound("Workspace");

      const [
        todayRows,
        completedToday,
        jobsUnscheduled,
        jobsUnassigned,
        revenueWeekRows,
        bookedWeekRows,
        openInvoices,
        activeCustomers,
        recurringJobs,
        openDeals,
        openEstimates,
        upcomingRows,
      ] = await Promise.all([
        prisma.job.findMany({
          where: {
            workspaceId: auth.workspaceId,
            scheduledStart: { gte: start, lt: end },
          },
          include: jobInclude,
          orderBy: [{ scheduledStart: "asc" }, { createdAt: "desc" }],
        }),
        prisma.job.findMany({
          where: { workspaceId: auth.workspaceId, completedAt: { gte: start, lt: end } },
          select: { total: true },
        }),
        prisma.job.count({
          where: { workspaceId: auth.workspaceId, status: "UNSCHEDULED" },
        }),
        prisma.job.count({
          where: {
            workspaceId: auth.workspaceId,
            status: { in: openStatuses },
            assigneeId: null,
          },
        }),
        prisma.job.aggregate({
          where: {
            workspaceId: auth.workspaceId,
            completedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
          },
          _sum: { total: true },
        }),
        prisma.job.aggregate({
          where: {
            workspaceId: auth.workspaceId,
            status: { notIn: ["CANCELED", "COMPLETED"] },
            scheduledStart: { gte: now, lt: weekEnd },
          },
          _sum: { total: true },
        }),
        prisma.invoice.findMany({
          where: {
            workspaceId: auth.workspaceId,
            status: { notIn: ["PAID", "VOID", "DRAFT"] },
          },
          select: { amount: true, amountPaid: true, dueAt: true },
        }),
        prisma.company.count({ where: { workspaceId: auth.workspaceId, archived: false } }),
        prisma.job.count({
          where: {
            workspaceId: auth.workspaceId,
            recurrence: { not: null },
            status: { in: openStatuses },
          },
        }),
        prisma.deal.findMany({
          where: { workspaceId: auth.workspaceId, stage: { kind: "OPEN" } },
          select: { value: true },
        }),
        prisma.estimate.findMany({
          where: { workspaceId: auth.workspaceId, status: { in: ["DRAFT", "SENT"] } },
          select: { total: true },
        }),
        prisma.job.findMany({
          where: {
            workspaceId: auth.workspaceId,
            scheduledStart: { gte: now },
            status: { in: openStatuses },
          },
          include: jobInclude,
          orderBy: { scheduledStart: "asc" },
          take: 6,
        }),
      ]);

      const outstanding = openInvoices.reduce(
        (sum, invoice) => sum + Math.max(0, invoice.amount - invoice.amountPaid),
        0,
      );
      const overdueInvoices = openInvoices.filter(
        (invoice) => invoice.dueAt !== null && invoice.dueAt.getTime() < now.getTime(),
      ).length;

      const today = todayRows.map(toJob);
      const upcoming = upcomingRows.map(toJob);

      return {
        date: start.toISOString().slice(0, 10),
        jobsToday: today.length,
        jobsTodayCompleted: completedToday.length,
        jobsUnscheduled,
        jobsUnassigned,
        revenueToday: completedToday.reduce((sum, job) => sum + job.total, 0),
        revenueWeek: revenueWeekRows._sum.total ?? 0,
        bookedWeek: bookedWeekRows._sum.total ?? 0,
        outstanding,
        overdueInvoices,
        activeCustomers,
        recurringJobs,
        pipelineValue: openDeals.reduce((sum, deal) => sum + deal.value, 0),
        openEstimates: openEstimates.length,
        openEstimateValue: openEstimates.reduce((sum, estimate) => sum + estimate.total, 0),
        today,
        upcoming,
        currency: workspace.currency,
      };
    },
  );
}
