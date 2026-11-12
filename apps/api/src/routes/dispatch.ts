import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import {
  dispatchAssignSchema,
  dispatchDateSchema,
  estimateDriveMinutes,
  optimizeRoute,
  type DispatchBoard,
  type DispatchMap,
  type DispatchRoute,
  type DispatchStats,
  type DispatchStop,
  type DispatchTechnician,
  type GeoPoint,
  type JobStatus,
  type RoutePoint,
} from "@meridian/contracts";
import { authenticate, getAuth } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/db.js";
import { badRequest, iso, notFound, parseOrThrow } from "../lib/http.js";
import { applyJobStatus } from "../lib/job-status.js";
import { assertNoScheduleConflict } from "../lib/schedule.js";
import { userSelect } from "../lib/service-ops.js";
import { jobInclude, toJob, type JobRow } from "./jobs.js";

const DAY_MS = 86_400_000;
const BOARD_MINUTES = 480;

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A bare calendar date is a UTC day; any other value is read as an instant. */
function parseDay(value: string | undefined): Date {
  if (!value) return startOfUtcDay(new Date());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw badRequest("Invalid dispatch date");
    }
    return date;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw badRequest("Invalid dispatch date");
  return startOfUtcDay(parsed);
}

function formatAddress(location: {
  line1: string;
  city: string;
  state: string | null;
  postalCode: string | null;
}): string {
  const region = [location.state, location.postalCode]
    .filter(Boolean)
    .join(" ");
  return [location.line1, location.city, region].filter(Boolean).join(", ");
}

type Coordinates = { latitude: number; longitude: number };

async function loadDayJobs(
  workspaceId: string,
  day: Date,
  assigneeId?: string,
): Promise<JobRow[]> {
  const where: Prisma.JobWhereInput = {
    workspaceId,
    scheduledStart: { gte: day, lt: new Date(day.getTime() + DAY_MS) },
    ...(assigneeId ? { assigneeId } : {}),
  };
  return prisma.job.findMany({
    where,
    include: jobInclude,
    orderBy: [{ scheduledStart: "asc" }, { createdAt: "asc" }],
  });
}

/** `jobInclude` narrows the location, so coordinates are loaded separately. */
async function loadLocationPoints(
  workspaceId: string,
  locationIds: string[],
): Promise<Map<string, Coordinates>> {
  const points = new Map<string, Coordinates>();
  if (locationIds.length === 0) return points;
  const locations = await prisma.location.findMany({
    where: { workspaceId, id: { in: locationIds } },
    select: { id: true, latitude: true, longitude: true },
  });
  for (const location of locations) {
    if (location.latitude !== null && location.longitude !== null) {
      points.set(location.id, {
        latitude: location.latitude,
        longitude: location.longitude,
      });
    }
  }
  return points;
}

async function loadDepot(workspaceId: string): Promise<GeoPoint | null> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { depotLatitude: true, depotLongitude: true },
  });
  if (
    !workspace ||
    workspace.depotLatitude === null ||
    workspace.depotLongitude === null
  ) {
    return null;
  }
  return {
    latitude: workspace.depotLatitude,
    longitude: workspace.depotLongitude,
  };
}

function toDispatchStop(
  row: JobRow,
  coordinates: Coordinates,
  routeOrder: number | null,
): DispatchStop {
  return {
    jobId: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
    priority: row.priority,
    customerName: row.customer.name,
    address: formatAddress(row.location),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    scheduledStart: iso(row.scheduledStart),
    scheduledEnd: iso(row.scheduledEnd),
    assignee: row.assignee,
    routeOrder,
  };
}

function averageCenter(stops: DispatchStop[]): GeoPoint | null {
  if (stops.length === 0) return null;
  const total = stops.reduce(
    (acc, stop) => ({
      latitude: acc.latitude + stop.latitude,
      longitude: acc.longitude + stop.longitude,
    }),
    { latitude: 0, longitude: 0 },
  );
  return {
    latitude: total.latitude / stops.length,
    longitude: total.longitude / stops.length,
  };
}

function buildStats(jobs: JobRow[], unassigned: number): DispatchStats {
  return {
    total: jobs.length,
    unassigned,
    inProgress: jobs.filter((row) => row.status === "IN_PROGRESS").length,
    completed: jobs.filter((row) => row.status === "COMPLETED").length,
    noShow: jobs.filter((row) => row.status === "NO_SHOW").length,
  };
}

interface RoutablePoint extends RoutePoint {
  row: JobRow;
}

export async function dispatchRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/dispatch/board",
    {
      preHandler: authenticate,
      schema: {
        tags: ["dispatch"],
        summary: "Daily dispatch board grouped by technician",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(dispatchDateSchema, request.query);
      const day = parseDay(query.date);

      const [memberships, jobs, depot] = await Promise.all([
        prisma.membership.findMany({
          where: { workspaceId: auth.workspaceId },
          select: { userId: true, user: { select: userSelect } },
          orderBy: { createdAt: "asc" },
        }),
        loadDayJobs(auth.workspaceId, day),
        loadDepot(auth.workspaceId),
      ]);

      const byAssignee = new Map<string, JobRow[]>();
      for (const row of jobs) {
        if (!row.assigneeId) continue;
        const bucket = byAssignee.get(row.assigneeId);
        if (bucket) bucket.push(row);
        else byAssignee.set(row.assigneeId, [row]);
      }

      const technicians: DispatchTechnician[] = memberships.map(
        (membership) => {
          const rows = byAssignee.get(membership.userId) ?? [];
          const scheduledMinutes = rows.reduce(
            (sum, row) => sum + row.durationMinutes,
            0,
          );
          return {
            user: membership.user,
            jobs: rows.map(toJob),
            jobCount: rows.length,
            scheduledMinutes,
            utilizationPct: Math.min(
              100,
              Math.round((scheduledMinutes / BOARD_MINUTES) * 100),
            ),
          };
        },
      );

      const unassignedRows = jobs.filter((row) => !row.assigneeId);

      const board: DispatchBoard = {
        date: formatDay(day),
        technicians,
        unassigned: unassignedRows.map(toJob),
        stats: buildStats(jobs, unassignedRows.length),
        depot,
      };
      return board;
    },
  );

  app.get(
    "/dispatch/map",
    {
      preHandler: authenticate,
      schema: {
        tags: ["dispatch"],
        summary: "Mappable stops for a dispatch day",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(dispatchDateSchema, request.query);
      const day = parseDay(query.date);

      const [jobs, depot] = await Promise.all([
        loadDayJobs(auth.workspaceId, day, query.assigneeId),
        loadDepot(auth.workspaceId),
      ]);
      const coordinates = await loadLocationPoints(auth.workspaceId, [
        ...new Set(jobs.map((row) => row.locationId)),
      ]);

      const stops: DispatchStop[] = [];
      for (const row of jobs) {
        const point = coordinates.get(row.locationId);
        if (point) stops.push(toDispatchStop(row, point, null));
      }

      const map: DispatchMap = {
        date: formatDay(day),
        stops,
        missingLocationCount: jobs.length - stops.length,
        depot,
        center: depot ?? averageCenter(stops),
      };
      return map;
    },
  );

  app.get(
    "/dispatch/route",
    {
      preHandler: authenticate,
      schema: {
        tags: ["dispatch"],
        summary: "Optimized driving route for one technician",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(dispatchDateSchema, request.query);
      if (!query.assigneeId) throw badRequest("An assignee is required");
      const day = parseDay(query.date);

      const membership = await prisma.membership.findFirst({
        where: { workspaceId: auth.workspaceId, userId: query.assigneeId },
        select: { user: { select: userSelect } },
      });
      if (!membership) throw notFound("Member");

      const [jobs, depot] = await Promise.all([
        loadDayJobs(auth.workspaceId, day, query.assigneeId),
        loadDepot(auth.workspaceId),
      ]);
      const coordinates = await loadLocationPoints(auth.workspaceId, [
        ...new Set(jobs.map((row) => row.locationId)),
      ]);

      const points: RoutablePoint[] = [];
      for (const row of jobs) {
        const point = coordinates.get(row.locationId);
        if (!point) continue;
        points.push({
          id: row.id,
          latitude: point.latitude,
          longitude: point.longitude,
          row,
        });
      }

      const first = points[0];
      let start: GeoPoint;
      if (depot) start = depot;
      else if (first)
        start = { latitude: first.latitude, longitude: first.longitude };
      else throw badRequest("No routable stops for this day");
      const { ordered, totalDistanceMeters } = optimizeRoute(start, points);
      const stops = ordered.map((point, index) =>
        toDispatchStop(point.row, point, index + 1),
      );

      const route: DispatchRoute = {
        date: formatDay(day),
        assignee: membership.user,
        start,
        stops,
        totalDistanceMeters,
        totalDurationMinutes: estimateDriveMinutes(
          totalDistanceMeters,
          stops.length,
        ),
        optimized: stops.length > 1,
      };
      return route;
    },
  );

  app.post(
    "/dispatch/assign",
    {
      preHandler: authenticate,
      schema: {
        tags: ["dispatch"],
        summary: "Bulk assign or unassign jobs",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const input = parseOrThrow(dispatchAssignSchema, request.body);
      const jobIds = [...new Set(input.jobIds)];

      const jobs = await prisma.job.findMany({
        where: { workspaceId: auth.workspaceId, id: { in: jobIds } },
        select: {
          id: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
        },
      });
      if (jobs.length !== jobIds.length) throw notFound("Job");

      if (input.assigneeId) {
        const member = await prisma.membership.findFirst({
          where: { workspaceId: auth.workspaceId, userId: input.assigneeId },
          select: { id: true },
        });
        if (!member) throw notFound("Member");
      }

      await prisma.$transaction(async (tx) => {
        for (const job of jobs) {
          if (input.assigneeId && job.scheduledStart) {
            await assertNoScheduleConflict(tx, {
              workspaceId: auth.workspaceId,
              assigneeId: input.assigneeId,
              start: job.scheduledStart,
              end: job.scheduledEnd,
              excludeJobId: job.id,
            });
          }

          await tx.job.update({
            where: { id: job.id },
            data: { assigneeId: input.assigneeId },
          });

          const status = job.status as JobStatus;
          if (input.assigneeId) {
            if (status === "UNSCHEDULED" || status === "SCHEDULED") {
              await applyJobStatus(tx, {
                workspaceId: auth.workspaceId,
                actorId: auth.userId,
                jobId: job.id,
                status: "DISPATCHED",
              });
            }
          } else if (status === "DISPATCHED") {
            await applyJobStatus(tx, {
              workspaceId: auth.workspaceId,
              actorId: auth.userId,
              jobId: job.id,
              status: "SCHEDULED",
            });
          }
        }
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "jobs.bulk_assigned",
        entityType: "job",
        metadata: {
          jobIds,
          assigneeId: input.assigneeId,
          count: jobs.length,
        },
      });

      return { updated: jobs.length };
    },
  );
}
