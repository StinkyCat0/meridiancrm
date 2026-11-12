import type { FastifyInstance } from "fastify";
import {
  OPEN_JOB_STATUSES,
  teamRangeSchema,
  teamWorkloadQuerySchema,
  type Role,
  type TeamMemberPerformance,
  type TeamPerformance,
  type TeamRangeQuery,
  type TeamTotals,
  type TeamWorkload,
  type TeamWorkloadMember,
} from "@meridian/contracts";
import { authenticate, getAuth } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import { badRequest, notFound, parseOrThrow } from "../lib/http.js";
import { userSelect } from "../lib/service-ops.js";

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;
const DAILY_CAPACITY_MINUTES = 480;
const OPEN_STATUSES = [...OPEN_JOB_STATUSES];

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Parses a YYYY-MM-DD date; defaults to today (UTC). */
function parseDay(value: string | undefined): Date {
  if (!value) return startOfUtcDay(new Date());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw badRequest("Use a YYYY-MM-DD date");
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  // Date.UTC rolls invalid values over (Feb 31 becomes Mar 3), so round-trip.
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw badRequest("Use a valid calendar date");
  }
  return date;
}

function resolveRange(query: TeamRangeQuery): { from: Date; to: Date } {
  const to = query.to ?? new Date();
  const requestedFrom = query.from ?? new Date(to.getTime() - 30 * DAY_MS);
  if (requestedFrom.getTime() > to.getTime()) {
    throw badRequest("`from` must be on or before `to`");
  }
  const earliest = new Date(to.getTime() - MAX_RANGE_DAYS * DAY_MS);
  return {
    from: new Date(Math.max(requestedFrom.getTime(), earliest.getTime())),
    to,
  };
}

/** Weekdays (Mon-Fri) touched by the inclusive range, counted in UTC. */
function weekdayCount(from: Date, to: Date): number {
  const first = startOfUtcDay(from).getTime();
  const last = startOfUtcDay(to).getTime();
  let count = 0;
  for (let cursor = first; cursor <= last; cursor += DAY_MS) {
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

function utilization(workedMinutes: number, capacityMinutes: number): number {
  if (capacityMinutes <= 0) return 0;
  return Math.min(100, Math.round((workedMinutes / capacityMinutes) * 100));
}

function roundRating(value: number): number {
  return Math.round(value * 10) / 10;
}

interface MemberAccumulator {
  user: TeamMemberPerformance["user"];
  role: Role;
  jobsScheduled: number;
  jobsCompleted: number;
  jobsCanceled: number;
  jobsNoShow: number;
  revenue: number;
  allocatedCost: number;
  completedMinutes: number;
  ratingSum: number;
  ratingCount: number;
  openJobs: number;
  upcomingMinutes: number;
}

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/team/performance",
    {
      preHandler: authenticate,
      schema: {
        tags: ["team"],
        summary: "Per-member performance, revenue and utilization",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<TeamPerformance> => {
      const auth = getAuth(request);
      const query = parseOrThrow(teamRangeSchema, request.query);
      const { from, to } = resolveRange(query);
      const now = new Date();
      const upcomingEnd = new Date(now.getTime() + 7 * DAY_MS);
      const weekdays = weekdayCount(from, to);

      const [
        workspace,
        memberships,
        jobs,
        openJobCounts,
        upcomingRows,
        paymentRows,
      ] = await Promise.all([
        prisma.workspace.findUnique({
          where: { id: auth.workspaceId },
          select: { currency: true },
        }),
        prisma.membership.findMany({
          where: { workspaceId: auth.workspaceId },
          select: {
            role: true,
            user: { select: userSelect },
          },
          orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
        }),
        prisma.job.findMany({
          where: {
            workspaceId: auth.workspaceId,
            OR: [
              { scheduledStart: { gte: from, lte: to } },
              { completedAt: { gte: from, lte: to } },
            ],
          },
          select: {
            assigneeId: true,
            status: true,
            scheduledStart: true,
            completedAt: true,
            durationMinutes: true,
            rating: true,
          },
        }),
        prisma.job.groupBy({
          by: ["assigneeId"],
          where: {
            workspaceId: auth.workspaceId,
            assigneeId: { not: null },
            status: { in: OPEN_STATUSES },
          },
          _count: { _all: true },
        }),
        prisma.job.groupBy({
          by: ["assigneeId"],
          where: {
            workspaceId: auth.workspaceId,
            assigneeId: { not: null },
            status: { in: OPEN_STATUSES },
            scheduledStart: { gte: now, lte: upcomingEnd },
          },
          _sum: { durationMinutes: true },
        }),
        prisma.payment.findMany({
          where: {
            workspaceId: auth.workspaceId,
            receivedAt: { gte: from, lte: to },
            // A payment only belongs to a member's revenue through its
            // invoice's job, and both sides must stay inside the workspace.
            invoice: { workspaceId: auth.workspaceId },
          },
          select: {
            amount: true,
            invoice: {
              select: {
                job: {
                  select: {
                    assigneeId: true,
                    subtotal: true,
                    total: true,
                    lineItems: { select: { quantity: true, unitCost: true } },
                  },
                },
              },
            },
          },
        }),
      ]);

      if (!workspace) throw notFound("Workspace");

      const stats = new Map<string, MemberAccumulator>();
      for (const membership of memberships) {
        stats.set(membership.user.id, {
          user: membership.user,
          role: membership.role as Role,
          jobsScheduled: 0,
          jobsCompleted: 0,
          jobsCanceled: 0,
          jobsNoShow: 0,
          revenue: 0,
          allocatedCost: 0,
          completedMinutes: 0,
          ratingSum: 0,
          ratingCount: 0,
          openJobs: 0,
          upcomingMinutes: 0,
        });
      }

      for (const job of jobs) {
        if (!job.assigneeId) continue;
        const member = stats.get(job.assigneeId);
        if (!member) continue;

        if (
          job.scheduledStart !== null &&
          job.scheduledStart.getTime() >= from.getTime() &&
          job.scheduledStart.getTime() <= to.getTime()
        ) {
          member.jobsScheduled += 1;
          if (job.status === "CANCELED") member.jobsCanceled += 1;
          if (job.status === "NO_SHOW") member.jobsNoShow += 1;
        }

        if (
          job.completedAt !== null &&
          job.completedAt.getTime() >= from.getTime() &&
          job.completedAt.getTime() <= to.getTime()
        ) {
          member.jobsCompleted += 1;
          member.completedMinutes += job.durationMinutes;
          if (job.rating !== null) {
            member.ratingSum += job.rating;
            member.ratingCount += 1;
          }
        }
      }

      for (const row of openJobCounts) {
        if (!row.assigneeId) continue;
        const member = stats.get(row.assigneeId);
        if (member) member.openJobs += row._count._all;
      }

      for (const row of upcomingRows) {
        if (!row.assigneeId) continue;
        const member = stats.get(row.assigneeId);
        if (member) member.upcomingMinutes += row._sum.durationMinutes ?? 0;
      }

      for (const payment of paymentRows) {
        const job = payment.invoice.job;
        if (!job || !job.assigneeId) continue;
        const member = stats.get(job.assigneeId);
        if (!member) continue;

        member.revenue += payment.amount;

        // Allocate line-item cost in proportion to the job's billed value.
        const lineCost = job.lineItems.reduce(
          (sum, line) => sum + line.quantity * line.unitCost,
          0,
        );
        const billedValue = job.subtotal > 0 ? job.subtotal : job.total;
        if (billedValue > 0 && lineCost > 0) {
          member.allocatedCost +=
            payment.amount * Math.min(lineCost / billedValue, 1);
        }
      }

      const members: TeamMemberPerformance[] = memberships.map((membership) => {
        const member = stats.get(membership.user.id);
        // Every membership was inserted above; fall back defensively rather
        // than throwing if the row disappeared mid-request.
        if (!member) {
          return {
            user: membership.user,
            role: membership.role as Role,
            jobsScheduled: 0,
            jobsCompleted: 0,
            jobsCanceled: 0,
            jobsNoShow: 0,
            revenue: 0,
            margin: 0,
            avgTicket: 0,
            utilizationPct: 0,
            ratingAvg: null,
            ratingCount: 0,
            openJobs: 0,
            upcomingMinutes: 0,
          };
        }

        return {
          user: member.user,
          role: member.role,
          jobsScheduled: member.jobsScheduled,
          jobsCompleted: member.jobsCompleted,
          jobsCanceled: member.jobsCanceled,
          jobsNoShow: member.jobsNoShow,
          revenue: member.revenue,
          margin: Math.round(member.revenue - member.allocatedCost),
          avgTicket:
            member.jobsCompleted > 0
              ? Math.round(member.revenue / member.jobsCompleted)
              : 0,
          utilizationPct: utilization(
            member.completedMinutes,
            weekdays * DAILY_CAPACITY_MINUTES,
          ),
          ratingAvg:
            member.ratingCount > 0
              ? roundRating(member.ratingSum / member.ratingCount)
              : null,
          ratingCount: member.ratingCount,
          openJobs: member.openJobs,
          upcomingMinutes: member.upcomingMinutes,
        };
      });

      const totals = members.reduce<TeamTotals>(
        (acc, member) => ({
          jobsScheduled: acc.jobsScheduled + member.jobsScheduled,
          jobsCompleted: acc.jobsCompleted + member.jobsCompleted,
          revenue: acc.revenue + member.revenue,
          margin: acc.margin + member.margin,
          avgTicket: 0,
          utilizationPct: 0,
          ratingAvg: null,
        }),
        {
          jobsScheduled: 0,
          jobsCompleted: 0,
          revenue: 0,
          margin: 0,
          avgTicket: 0,
          utilizationPct: 0,
          ratingAvg: null,
        },
      );

      const totalRatingCount = members.reduce(
        (sum, member) => sum + member.ratingCount,
        0,
      );
      const totalRatingSum = members.reduce(
        (sum, member) => sum + (member.ratingAvg ?? 0) * member.ratingCount,
        0,
      );
      const totalCompletedMinutes = memberships.reduce(
        (sum, membership) =>
          sum + (stats.get(membership.user.id)?.completedMinutes ?? 0),
        0,
      );

      return {
        range: { from: from.toISOString(), to: to.toISOString() },
        currency: workspace.currency,
        members,
        totals: {
          ...totals,
          avgTicket:
            totals.jobsCompleted > 0
              ? Math.round(totals.revenue / totals.jobsCompleted)
              : 0,
          utilizationPct:
            members.length > 0
              ? utilization(
                  totalCompletedMinutes,
                  weekdays * DAILY_CAPACITY_MINUTES * members.length,
                )
              : 0,
          ratingAvg:
            totalRatingCount > 0
              ? roundRating(totalRatingSum / totalRatingCount)
              : null,
        },
      };
    },
  );

  app.get(
    "/team/workload",
    {
      preHandler: authenticate,
      schema: {
        tags: ["team"],
        summary: "Daily workload, capacity and next start per member",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<TeamWorkload> => {
      const auth = getAuth(request);
      const query = parseOrThrow(teamWorkloadQuerySchema, request.query);
      const start = parseDay(query.date);
      const end = new Date(start.getTime() + DAY_MS);
      const now = new Date();
      const isToday = start.getTime() === startOfUtcDay(now).getTime();
      const reference = isToday ? now : start;

      const [memberships, dayJobs, completedRows] = await Promise.all([
        prisma.membership.findMany({
          where: { workspaceId: auth.workspaceId },
          select: {
            role: true,
            user: { select: userSelect },
          },
          orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
        }),
        prisma.job.findMany({
          where: {
            workspaceId: auth.workspaceId,
            scheduledStart: { gte: start, lt: end },
            status: { notIn: ["CANCELED", "NO_SHOW"] },
          },
          select: {
            assigneeId: true,
            scheduledStart: true,
            durationMinutes: true,
          },
          orderBy: { scheduledStart: "asc" },
        }),
        prisma.job.groupBy({
          by: ["assigneeId"],
          where: {
            workspaceId: auth.workspaceId,
            assigneeId: { not: null },
            completedAt: { gte: start, lt: end },
          },
          _count: { _all: true },
        }),
      ]);

      const completedByUser = new Map<string, number>();
      for (const row of completedRows) {
        if (row.assigneeId)
          completedByUser.set(row.assigneeId, row._count._all);
      }

      const perMember = new Map<
        string,
        { jobCount: number; scheduledMinutes: number; nextStart: Date | null }
      >();
      for (const membership of memberships) {
        perMember.set(membership.user.id, {
          jobCount: 0,
          scheduledMinutes: 0,
          nextStart: null,
        });
      }

      let unassigned = 0;
      for (const job of dayJobs) {
        if (!job.assigneeId) {
          unassigned += 1;
          continue;
        }
        const bucket = perMember.get(job.assigneeId);
        if (!bucket) continue;
        bucket.jobCount += 1;
        bucket.scheduledMinutes += job.durationMinutes;
        if (
          bucket.nextStart === null &&
          job.scheduledStart !== null &&
          job.scheduledStart.getTime() >= reference.getTime()
        ) {
          bucket.nextStart = job.scheduledStart;
        }
      }

      const members: TeamWorkloadMember[] = memberships.map((membership) => {
        const bucket = perMember.get(membership.user.id);
        const jobCount = bucket?.jobCount ?? 0;
        const scheduledMinutes = bucket?.scheduledMinutes ?? 0;
        return {
          user: membership.user,
          jobCount,
          scheduledMinutes,
          capacityMinutes: DAILY_CAPACITY_MINUTES,
          utilizationPct: utilization(scheduledMinutes, DAILY_CAPACITY_MINUTES),
          nextStart: bucket?.nextStart ? bucket.nextStart.toISOString() : null,
          jobsCompletedToday: completedByUser.get(membership.user.id) ?? 0,
        };
      });

      const totalScheduledMinutes = members.reduce(
        (sum, member) => sum + member.scheduledMinutes,
        0,
      );

      return {
        date: start.toISOString().slice(0, 10),
        members,
        unassigned,
        totalScheduledMinutes,
      };
    },
  );
}
