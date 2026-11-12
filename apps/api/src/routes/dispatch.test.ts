import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/db.js";
import {
  authHeaders,
  createTestApp,
  registerAccount,
  resetDatabase,
  type TestAccount,
} from "../test/helpers.js";

let app: FastifyInstance;
let owner: TestAccount;

const DAY = "2026-03-10";
const NEXT_DAY = "2026-03-11";

function at(hour: number, minute = 0, dayOffset = 0): string {
  return new Date(
    Date.UTC(2026, 2, 10 + dayOffset, hour, minute),
  ).toISOString();
}

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  owner = await registerAccount(app, { name: "Dispatch Owner" });
});

function asOwner() {
  return authHeaders(owner);
}

async function createCustomer(name = "Cedar & Co") {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/companies",
    headers: asOwner(),
    payload: { name, customerType: "RESIDENTIAL", phone: "503-555-0100" },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; name: string };
}

async function createLocation(
  customerId: string,
  payload: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/locations",
    headers: asOwner(),
    payload: {
      customerId,
      label: "Main",
      line1: "412 Alder Street",
      city: "Portland",
      state: "OR",
      postalCode: "97205",
      ...payload,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; line1: string };
}

async function createJob(payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/jobs",
    headers: asOwner(),
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json() as {
    id: string;
    status: string;
    assigneeId?: string | null;
  };
}

async function addTechnician(name: string, workspaceId = owner.workspaceId) {
  const account = await registerAccount(app, { name });
  await prisma.membership.create({
    data: { userId: account.userId, workspaceId, role: "MEMBER" },
  });
  return account;
}

async function setDepot(latitude: number, longitude: number) {
  const response = await app.inject({
    method: "PATCH",
    url: "/api/v1/workspace",
    headers: asOwner(),
    payload: { depotLatitude: latitude, depotLongitude: longitude },
  });
  expect(response.statusCode).toBe(200);
}

type BoardBody = {
  date: string;
  technicians: Array<{
    user: { id: string; name: string };
    jobs: Array<{ id: string }>;
    jobCount: number;
    scheduledMinutes: number;
    utilizationPct: number;
  }>;
  unassigned: Array<{ id: string }>;
  stats: {
    total: number;
    unassigned: number;
    inProgress: number;
    completed: number;
    noShow: number;
  };
  depot: { latitude: number; longitude: number } | null;
};

describe("GET /dispatch/board", () => {
  it("groups the day's jobs by technician and reports board stats", async () => {
    const tech = await addTechnician("Tech One");
    await addTechnician("Idle Tech");
    await setDepot(45.52, -122.68);

    const customer = await createCustomer();
    const location = await createLocation(customer.id);

    const ownerMorning = await createJob({
      title: "Owner morning",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      assigneeId: owner.userId,
      scheduledStart: at(9),
      durationMinutes: 120,
    });
    const ownerAfternoon = await createJob({
      title: "Owner wrap up",
      customerId: customer.id,
      locationId: location.id,
      status: "COMPLETED",
      assigneeId: owner.userId,
      scheduledStart: at(13),
      durationMinutes: 120,
    });
    const techMorning = await createJob({
      title: "Tech morning",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      assigneeId: tech.userId,
      scheduledStart: at(10),
      durationMinutes: 60,
    });
    const techActive = await createJob({
      title: "Tech active",
      customerId: customer.id,
      locationId: location.id,
      status: "IN_PROGRESS",
      assigneeId: tech.userId,
      scheduledStart: at(11),
      durationMinutes: 60,
    });
    const unassignedOne = await createJob({
      title: "Nobody yet",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      scheduledStart: at(12),
      durationMinutes: 30,
    });
    const unassignedNoShow = await createJob({
      title: "No show",
      customerId: customer.id,
      locationId: location.id,
      status: "NO_SHOW",
      scheduledStart: at(14),
      durationMinutes: 45,
    });
    await createJob({
      title: "Tomorrow",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      assigneeId: owner.userId,
      scheduledStart: at(9, 0, 1),
      durationMinutes: 60,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/dispatch/board?date=${DAY}`,
      headers: asOwner(),
    });
    expect(response.statusCode).toBe(200);
    const board = response.json() as BoardBody;

    expect(board.date).toBe(DAY);
    expect(board.depot).toEqual({ latitude: 45.52, longitude: -122.68 });
    expect(board.technicians).toHaveLength(3);

    const ownerEntry = board.technicians.find(
      (entry) => entry.user.id === owner.userId,
    );
    expect(ownerEntry).toBeDefined();
    expect(ownerEntry?.jobCount).toBe(2);
    expect(ownerEntry?.scheduledMinutes).toBe(240);
    expect(ownerEntry?.utilizationPct).toBe(50);
    expect(ownerEntry?.jobs.map((job) => job.id)).toEqual([
      ownerMorning.id,
      ownerAfternoon.id,
    ]);

    const techEntry = board.technicians.find(
      (entry) => entry.user.id === tech.userId,
    );
    expect(techEntry?.jobCount).toBe(2);
    expect(techEntry?.scheduledMinutes).toBe(120);
    expect(techEntry?.utilizationPct).toBe(25);
    expect(techEntry?.jobs.map((job) => job.id)).toEqual([
      techMorning.id,
      techActive.id,
    ]);

    const idleEntry = board.technicians.find((entry) => entry.jobCount === 0);
    expect(idleEntry?.scheduledMinutes).toBe(0);
    expect(idleEntry?.utilizationPct).toBe(0);

    expect(board.unassigned.map((job) => job.id)).toEqual([
      unassignedOne.id,
      unassignedNoShow.id,
    ]);
    expect(board.stats).toEqual({
      total: 6,
      unassigned: 2,
      inProgress: 1,
      completed: 1,
      noShow: 1,
    });
  });

  it("moves jobs from former members into the unassigned lane", async () => {
    const tech = await addTechnician("Former Tech");
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const job = await createJob({
      title: "Orphaned visit",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      assigneeId: tech.userId,
      scheduledStart: at(9),
      durationMinutes: 60,
    });

    await prisma.membership.delete({
      where: {
        userId_workspaceId: {
          userId: tech.userId,
          workspaceId: owner.workspaceId,
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/dispatch/board?date=${DAY}`,
      headers: asOwner(),
    });
    expect(response.statusCode).toBe(200);
    const board = response.json() as Omit<BoardBody, "unassigned"> & {
      unassigned: Array<{
        id: string;
        assignee: { id: string; name: string } | null;
      }>;
    };

    expect(
      board.technicians.some((entry) => entry.user.id === tech.userId),
    ).toBe(false);
    const unassignedJob = board.unassigned.find((row) => row.id === job.id);
    expect(unassignedJob).toBeDefined();
    // The assignee summary stays on the job payload even though the user is
    // no longer a member and therefore has no lane.
    expect(unassignedJob?.assignee?.id).toBe(tech.userId);
    expect(board.stats).toEqual({
      total: 1,
      unassigned: 1,
      inProgress: 0,
      completed: 0,
      noShow: 0,
    });
  });

  it("defaults to the current UTC day and caps utilization at 100%", async () => {
    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const todayStart = new Date();
    const scheduledStart = new Date(
      Date.UTC(
        todayStart.getUTCFullYear(),
        todayStart.getUTCMonth(),
        todayStart.getUTCDate(),
        8,
      ),
    ).toISOString();
    const job = await createJob({
      title: "Long day",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      assigneeId: owner.userId,
      scheduledStart,
      durationMinutes: 1440,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/dispatch/board",
      headers: asOwner(),
    });
    expect(response.statusCode).toBe(200);
    const board = response.json() as BoardBody;

    expect(board.date).toBe(todayStart.toISOString().slice(0, 10));
    expect(
      board.technicians.find((entry) => entry.user.id === owner.userId)
        ?.utilizationPct,
    ).toBe(100);
    expect(board.stats.total).toBeGreaterThanOrEqual(1);
    expect(board.unassigned.some((row) => row.id === job.id)).toBe(false);
  });
});

type MapBody = {
  date: string;
  stops: Array<{
    jobId: string;
    address: string;
    customerName: string;
    status: string;
    priority: string;
    latitude: number;
    longitude: number;
    scheduledStart: string | null;
    assignee: { id: string } | null;
    routeOrder: number | null;
  }>;
  missingLocationCount: number;
  depot: { latitude: number; longitude: number } | null;
  center: { latitude: number; longitude: number } | null;
};

describe("GET /dispatch/map", () => {
  it("returns only geocoded stops and counts the rest as missing", async () => {
    const tech = await addTechnician("Map Tech");
    const customer = await createCustomer();
    const geocoded = await createLocation(customer.id, {
      line1: "100 Geocode Way",
      latitude: 45.52,
      longitude: -122.68,
    });
    const ungeocoded = await createLocation(customer.id, {
      line1: "200 Nowhere Lane",
    });
    const farStop = await createLocation(customer.id, {
      line1: "300 Far Road",
      latitude: 45.5,
      longitude: -122.7,
    });

    const nearJob = await createJob({
      title: "Near stop",
      customerId: customer.id,
      locationId: geocoded.id,
      status: "SCHEDULED",
      assigneeId: tech.userId,
      scheduledStart: at(9),
      durationMinutes: 60,
    });
    await createJob({
      title: "No pin",
      customerId: customer.id,
      locationId: ungeocoded.id,
      status: "SCHEDULED",
      assigneeId: tech.userId,
      scheduledStart: at(10),
      durationMinutes: 60,
    });
    const farJob = await createJob({
      title: "Far stop",
      customerId: customer.id,
      locationId: farStop.id,
      status: "SCHEDULED",
      assigneeId: tech.userId,
      scheduledStart: at(11),
      durationMinutes: 60,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/dispatch/map?date=${DAY}`,
      headers: asOwner(),
    });
    expect(response.statusCode).toBe(200);
    const map = response.json() as MapBody;

    expect(map.date).toBe(DAY);
    expect(map.depot).toBeNull();
    expect(map.stops).toHaveLength(2);
    expect(map.missingLocationCount).toBe(1);
    expect(map.stops.map((stop) => stop.jobId)).toEqual([
      nearJob.id,
      farJob.id,
    ]);
    expect(map.stops.map((stop) => stop.routeOrder)).toEqual([null, null]);

    const near = map.stops[0];
    expect(near).toMatchObject({
      customerName: customer.name,
      status: "SCHEDULED",
      priority: "NORMAL",
      latitude: 45.52,
      longitude: -122.68,
    });
    expect(near?.address).toContain("100 Geocode Way");
    expect(near?.scheduledStart).toBe(at(9));
    expect(near?.assignee?.id).toBe(tech.userId);
    expect(map.center?.latitude).toBeCloseTo((45.52 + 45.5) / 2, 5);
    expect(map.center?.longitude).toBeCloseTo((-122.68 - 122.7) / 2, 5);

    const filtered = await app.inject({
      method: "GET",
      url: `/api/v1/dispatch/map?date=${NEXT_DAY}`,
      headers: asOwner(),
    });
    expect((filtered.json() as MapBody).stops).toHaveLength(0);
  });

  it("prefers the workspace depot as the map center", async () => {
    await setDepot(45.4, -122.5);
    const customer = await createCustomer();
    const location = await createLocation(customer.id, {
      latitude: 45.6,
      longitude: -122.6,
    });
    await createJob({
      title: "Stop",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      scheduledStart: at(9),
      durationMinutes: 30,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/dispatch/map?date=${DAY}`,
      headers: asOwner(),
    });
    expect(response.statusCode).toBe(200);
    const map = response.json() as MapBody;
    expect(map.center).toEqual({ latitude: 45.4, longitude: -122.5 });
  });
});

type RouteBody = {
  date: string;
  assignee: { id: string; name: string };
  start: { latitude: number; longitude: number };
  stops: Array<{ jobId: string; routeOrder: number | null }>;
  totalDistanceMeters: number;
  totalDurationMinutes: number;
  optimized: boolean;
};

describe("GET /dispatch/route", () => {
  it("orders stops from the depot and reports distance and duration", async () => {
    const tech = await addTechnician("Route Tech");
    await setDepot(45.52, -122.68);
    const customer = await createCustomer();

    const far = await createLocation(customer.id, {
      label: "Far",
      latitude: 45.6,
      longitude: -122.6,
    });
    const near = await createLocation(customer.id, {
      label: "Near",
      latitude: 45.521,
      longitude: -122.681,
    });
    const middle = await createLocation(customer.id, {
      label: "Middle",
      latitude: 45.55,
      longitude: -122.65,
    });

    const farJob = await createJob({
      title: "Far job",
      customerId: customer.id,
      locationId: far.id,
      status: "SCHEDULED",
      assigneeId: tech.userId,
      scheduledStart: at(13),
      durationMinutes: 60,
    });
    const nearJob = await createJob({
      title: "Near job",
      customerId: customer.id,
      locationId: near.id,
      status: "SCHEDULED",
      assigneeId: tech.userId,
      scheduledStart: at(9),
      durationMinutes: 60,
    });
    const middleJob = await createJob({
      title: "Middle job",
      customerId: customer.id,
      locationId: middle.id,
      status: "SCHEDULED",
      assigneeId: tech.userId,
      scheduledStart: at(11),
      durationMinutes: 60,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/dispatch/route?date=${DAY}&assigneeId=${tech.userId}`,
      headers: asOwner(),
    });
    expect(response.statusCode).toBe(200);
    const route = response.json() as RouteBody;

    expect(route.date).toBe(DAY);
    expect(route.assignee.id).toBe(tech.userId);
    expect(route.start).toEqual({ latitude: 45.52, longitude: -122.68 });
    expect(route.stops.map((stop) => stop.jobId)).toEqual([
      nearJob.id,
      middleJob.id,
      farJob.id,
    ]);
    expect(route.stops.map((stop) => stop.routeOrder)).toEqual([1, 2, 3]);
    expect(route.optimized).toBe(true);
    expect(route.totalDistanceMeters).toBeGreaterThan(0);
    expect(route.totalDurationMinutes).toBeGreaterThan(0);
  });

  it("falls back to the first stop when the workspace has no depot", async () => {
    const tech = await addTechnician("No Depot Tech");
    const customer = await createCustomer();
    const only = await createLocation(customer.id, {
      latitude: 45.6,
      longitude: -122.6,
    });
    const job = await createJob({
      title: "Only job",
      customerId: customer.id,
      locationId: only.id,
      status: "SCHEDULED",
      assigneeId: tech.userId,
      scheduledStart: at(9),
      durationMinutes: 60,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/dispatch/route?date=${DAY}&assigneeId=${tech.userId}`,
      headers: asOwner(),
    });
    expect(response.statusCode).toBe(200);
    const route = response.json() as RouteBody;
    expect(route.start).toEqual({ latitude: 45.6, longitude: -122.6 });
    expect(route.stops.map((stop) => stop.jobId)).toEqual([job.id]);
    expect(route.stops[0]?.routeOrder).toBe(1);
    expect(route.optimized).toBe(false);
  });

  it("rejects an assignee who is not a workspace member", async () => {
    const outsider = await registerAccount(app, { name: "Outsider" });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/dispatch/route?date=${DAY}&assigneeId=${outsider.userId}`,
      headers: asOwner(),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("POST /dispatch/assign", () => {
  it("assigns and unassigns a batch, moving status and writing an audit entry", async () => {
    const tech = await addTechnician("Assign Tech");
    const customer = await createCustomer();
    const location = await createLocation(customer.id);

    const first = await createJob({
      title: "First",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      scheduledStart: at(9),
      durationMinutes: 60,
    });
    const second = await createJob({
      title: "Second",
      customerId: customer.id,
      locationId: location.id,
      status: "UNSCHEDULED",
      durationMinutes: 60,
    });

    const assigned = await app.inject({
      method: "POST",
      url: "/api/v1/dispatch/assign",
      headers: asOwner(),
      payload: { jobIds: [first.id, second.id], assigneeId: tech.userId },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toEqual({ updated: 2 });

    const scheduled = await prisma.job.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(scheduled.assigneeId).toBe(tech.userId);
    expect(scheduled.status).toBe("DISPATCHED");
    const unscheduled = await prisma.job.findUniqueOrThrow({
      where: { id: second.id },
    });
    expect(unscheduled.assigneeId).toBe(tech.userId);
    expect(unscheduled.status).toBe("DISPATCHED");

    const auditEntry = await prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: owner.workspaceId, action: "jobs.bulk_assigned" },
    });
    expect(JSON.parse(auditEntry.metadata ?? "{}")).toMatchObject({
      jobIds: [first.id, second.id],
      assigneeId: tech.userId,
      count: 2,
    });

    const unassigned = await app.inject({
      method: "POST",
      url: "/api/v1/dispatch/assign",
      headers: asOwner(),
      payload: { jobIds: [first.id, second.id], assigneeId: null },
    });
    expect(unassigned.statusCode).toBe(200);
    expect(unassigned.json()).toEqual({ updated: 2 });

    const released = await prisma.job.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(released.assigneeId).toBeNull();
    expect(released.status).toBe("SCHEDULED");
  });

  it("rejects an overlapping batch atomically", async () => {
    const tech = await addTechnician("Busy Tech");
    const customer = await createCustomer();
    const location = await createLocation(customer.id);

    await createJob({
      title: "Booked",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      assigneeId: tech.userId,
      scheduledStart: at(9),
      durationMinutes: 60,
    });
    const conflicting = await createJob({
      title: "Overlap",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      scheduledStart: at(9, 30),
      durationMinutes: 60,
    });
    const clear = await createJob({
      title: "Clear",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      scheduledStart: at(11),
      durationMinutes: 60,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/dispatch/assign",
      headers: asOwner(),
      payload: { jobIds: [clear.id, conflicting.id], assigneeId: tech.userId },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "CONFLICT" } });

    const untouched = await prisma.job.findUniqueOrThrow({
      where: { id: clear.id },
    });
    expect(untouched.assigneeId).toBeNull();
    expect(untouched.status).toBe("SCHEDULED");
    const rejected = await prisma.job.findUniqueOrThrow({
      where: { id: conflicting.id },
    });
    expect(rejected.assigneeId).toBeNull();
  });

  it("does not accept jobs or assignees from another workspace", async () => {
    const outsider = await registerAccount(app, { name: "Other Tenant" });
    const outsiderCustomer = await app.inject({
      method: "POST",
      url: "/api/v1/companies",
      headers: authHeaders(outsider),
      payload: { name: "Outsider Co", customerType: "COMMERCIAL" },
    });
    expect(outsiderCustomer.statusCode).toBe(201);
    const outsiderLocation = await app.inject({
      method: "POST",
      url: "/api/v1/locations",
      headers: authHeaders(outsider),
      payload: {
        customerId: outsiderCustomer.json().id,
        line1: "9 Elsewhere",
        city: "Seattle",
        state: "WA",
        latitude: 47.6,
        longitude: -122.3,
      },
    });
    expect(outsiderLocation.statusCode).toBe(201);
    const outsiderJob = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: authHeaders(outsider),
      payload: {
        title: "Not yours",
        customerId: outsiderCustomer.json().id,
        locationId: outsiderLocation.json().id,
        status: "SCHEDULED",
        scheduledStart: at(9),
        durationMinutes: 60,
      },
    });
    expect(outsiderJob.statusCode).toBe(201);

    const foreignJob = await app.inject({
      method: "POST",
      url: "/api/v1/dispatch/assign",
      headers: asOwner(),
      payload: { jobIds: [outsiderJob.json().id], assigneeId: owner.userId },
    });
    expect(foreignJob.statusCode).toBe(404);

    const customer = await createCustomer();
    const location = await createLocation(customer.id);
    const ownJob = await createJob({
      title: "Mine",
      customerId: customer.id,
      locationId: location.id,
      status: "SCHEDULED",
      scheduledStart: at(9),
      durationMinutes: 60,
    });
    const foreignAssignee = await app.inject({
      method: "POST",
      url: "/api/v1/dispatch/assign",
      headers: asOwner(),
      payload: { jobIds: [ownJob.id], assigneeId: outsider.userId },
    });
    expect(foreignAssignee.statusCode).toBe(404);

    const unchanged = await prisma.job.findUniqueOrThrow({
      where: { id: ownJob.id },
    });
    expect(unchanged.assigneeId).toBeNull();

    const board = await app.inject({
      method: "GET",
      url: `/api/v1/dispatch/board?date=${DAY}`,
      headers: asOwner(),
    });
    expect(board.statusCode).toBe(200);
    const stats = (board.json() as BoardBody).stats;
    expect(stats.total).toBe(1);

    const map = await app.inject({
      method: "GET",
      url: `/api/v1/dispatch/map?date=${DAY}&assigneeId=${outsider.userId}`,
      headers: asOwner(),
    });
    expect(map.statusCode).toBe(200);
    expect((map.json() as MapBody).stops).toHaveLength(0);
  });
});
