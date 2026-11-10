import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  computeMomentum,
  dealInputSchema,
  dealPatchSchema,
  idSchema,
  paginationSchema,
  stageMoveSchema,
  type Deal,
  type PublicUser,
  type Stage,
  type StageHistoryEntry,
  type StageKind,
} from "@meridian/contracts";
import type { Prisma } from "@prisma/client";
import { authenticate, getAuth, requireRole } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/db.js";
import { badRequest, likeTerm, notFound, pageMeta, parseOrThrow, parseTags, serializeTags } from "../lib/http.js";

const DAY_MS = 86_400_000;

const userSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

export const dealInclude = {
  stage: true,
  contact: { select: { id: true, firstName: true, lastName: true, email: true } },
  company: { select: { id: true, name: true, domain: true } },
  owner: { select: userSelect },
} satisfies Prisma.DealInclude;

export type DealWithRelations = Prisma.DealGetPayload<{ include: typeof dealInclude }>;

type StageShape = {
  id: string;
  pipelineId: string;
  name: string;
  order: number;
  probability: number;
  kind: string;
  targetDays: number;
};

export interface DealActivityStats {
  count30d: number;
  lastActivityAt: Date | null;
}

const listQuerySchema = paginationSchema.extend({
  stageId: idSchema.optional(),
  pipelineId: idSchema.optional(),
  ownerId: idSchema.optional(),
  companyId: idSchema.optional(),
  contactId: idSchema.optional(),
  status: z.enum(["open", "won", "lost", "all"]).default("all"),
});

const idParamsSchema = z.object({ id: idSchema });

function toPublicUser(user: PublicUser | null | undefined): PublicUser | null {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
}

export function toStage(stage: StageShape): Stage {
  return {
    id: stage.id,
    pipelineId: stage.pipelineId,
    name: stage.name,
    order: stage.order,
    probability: stage.probability,
    kind: stage.kind as StageKind,
    targetDays: stage.targetDays,
  };
}

/**
 * One batched read per deal page (no per-deal queries): 30-day activity counts and
 * the most recent activity across all time, grouped by dealId.
 */
export async function loadDealActivityStats(
  workspaceId: string,
  dealIds: string[],
  now: Date = new Date(),
): Promise<Map<string, DealActivityStats>> {
  const stats = new Map<string, DealActivityStats>();
  if (!dealIds.length) return stats;
  for (const id of dealIds) stats.set(id, { count30d: 0, lastActivityAt: null });

  const cutoff = new Date(now.getTime() - 30 * DAY_MS);
  const [recent, overall] = await Promise.all([
    prisma.activity.groupBy({
      by: ["dealId"],
      where: { workspaceId, dealId: { in: dealIds }, createdAt: { gte: cutoff } },
      _count: { _all: true },
    }),
    prisma.activity.groupBy({
      by: ["dealId"],
      where: { workspaceId, dealId: { in: dealIds } },
      _max: { createdAt: true },
    }),
  ]);

  for (const row of recent) {
    if (!row.dealId) continue;
    const entry = stats.get(row.dealId);
    if (entry) entry.count30d = row._count._all;
  }
  for (const row of overall) {
    if (!row.dealId) continue;
    const entry = stats.get(row.dealId);
    if (entry) entry.lastActivityAt = row._max.createdAt;
  }
  return stats;
}

export function toDeal(
  row: DealWithRelations,
  stats: DealActivityStats | undefined,
  now: Date = new Date(),
): Deal {
  const stage = toStage(row.stage);
  const stageAgeDays = Math.max(
    0,
    Math.floor((now.getTime() - row.stageChangedAt.getTime()) / DAY_MS),
  );
  const lastActivityAt = stats?.lastActivityAt ?? null;
  const lastActivityDaysAgo = lastActivityAt
    ? Math.max(0, Math.floor((now.getTime() - lastActivityAt.getTime()) / DAY_MS))
    : null;

  const momentum = computeMomentum({
    stageKind: stage.kind,
    stageAgeDays,
    stageTargetDays: stage.targetDays,
    activityCount30d: stats?.count30d ?? 0,
    lastActivityDaysAgo,
    expectedCloseDate: row.expectedCloseDate,
    now,
  });

  return {
    id: row.id,
    title: row.title,
    value: row.value,
    currency: row.currency,
    probability: stage.probability,
    stageId: row.stageId,
    stage,
    pipelineId: row.pipelineId,
    contact: row.contact
      ? {
          id: row.contact.id,
          firstName: row.contact.firstName,
          lastName: row.contact.lastName,
          email: row.contact.email,
        }
      : null,
    company: row.company
      ? { id: row.company.id, name: row.company.name, domain: row.company.domain }
      : null,
    owner: toPublicUser(row.owner),
    expectedCloseDate: row.expectedCloseDate ? row.expectedCloseDate.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    stageChangedAt: row.stageChangedAt.toISOString(),
    description: row.description,
    tags: parseTags(row.tags),
    momentum,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function dealOrder(
  sort: string | undefined,
  order: "asc" | "desc",
): Prisma.DealOrderByWithRelationInput {
  switch (sort) {
    case "createdAt":
      return { createdAt: order };
    case "value":
      return { value: order };
    case "expectedCloseDate":
      return { expectedCloseDate: order };
    case "updatedAt":
      return { updatedAt: order };
    default:
      return { updatedAt: order };
  }
}

async function requireStage(workspaceId: string, stageId: string): Promise<StageShape> {
  const stage = await prisma.stage.findFirst({
    where: { id: stageId, pipeline: { workspaceId } },
    select: {
      id: true,
      pipelineId: true,
      name: true,
      order: true,
      probability: true,
      kind: true,
      targetDays: true,
    },
  });
  if (!stage) throw notFound("Stage");
  return stage;
}

async function requireContact(workspaceId: string, contactId: string): Promise<void> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { id: true },
  });
  if (!contact) throw notFound("Contact");
}

async function requireCompany(workspaceId: string, companyId: string): Promise<void> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, workspaceId },
    select: { id: true },
  });
  if (!company) throw notFound("Company");
}

async function resolveOwnerId(
  workspaceId: string,
  requested: string | null | undefined,
  fallback: string,
): Promise<string | null> {
  if (requested === undefined) return fallback;
  if (requested === null) return null;
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: requested, workspaceId } },
    select: { id: true },
  });
  if (!membership) throw badRequest("Owner must be a member of this workspace");
  return requested;
}

async function loadDeal(workspaceId: string, id: string): Promise<DealWithRelations> {
  const row = await prisma.deal.findFirst({ where: { id, workspaceId }, include: dealInclude });
  if (!row) throw notFound("Deal");
  return row;
}

async function serializeDeal(workspaceId: string, row: DealWithRelations): Promise<Deal> {
  const stats = await loadDealActivityStats(workspaceId, [row.id]);
  return toDeal(row, stats.get(row.id));
}

export async function dealRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/deals",
    {
      preHandler: authenticate,
      schema: {
        tags: ["deals"],
        summary: "List deals with filters, stage, momentum and pagination",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const query = parseOrThrow(listQuerySchema, request.query);

      const stageFilter: Prisma.StageWhereInput = {};
      if (query.stageId) stageFilter.id = query.stageId;
      if (query.status !== "all") stageFilter.kind = query.status.toUpperCase();

      const where: Prisma.DealWhereInput = {
        workspaceId: auth.workspaceId,
        ...(query.q ? { title: { contains: likeTerm(query.q) } } : {}),
        ...(query.pipelineId ? { pipelineId: query.pipelineId } : {}),
        ...(query.ownerId ? { ownerId: query.ownerId } : {}),
        ...(query.companyId ? { companyId: query.companyId } : {}),
        ...(query.contactId ? { contactId: query.contactId } : {}),
        ...(Object.keys(stageFilter).length ? { stage: stageFilter } : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.deal.count({ where }),
        prisma.deal.findMany({
          where,
          include: dealInclude,
          orderBy: dealOrder(query.sort, query.order),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      const now = new Date();
      const stats = await loadDealActivityStats(
        auth.workspaceId,
        rows.map((row) => row.id),
        now,
      );

      return {
        data: rows.map((row) => toDeal(row, stats.get(row.id), now)),
        meta: pageMeta(total, query.page, query.pageSize),
      };
    },
  );

  app.post(
    "/deals",
    {
      preHandler: authenticate,
      schema: {
        tags: ["deals"],
        summary: "Create a deal",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const input = parseOrThrow(dealInputSchema, request.body);
      const stage = await requireStage(auth.workspaceId, input.stageId);
      if (input.contactId) await requireContact(auth.workspaceId, input.contactId);
      if (input.companyId) await requireCompany(auth.workspaceId, input.companyId);
      const ownerId = await resolveOwnerId(auth.workspaceId, input.ownerId, auth.userId);
      const now = new Date();

      const created = await prisma.$transaction(async (tx) => {
        const deal = await tx.deal.create({
          data: {
            workspaceId: auth.workspaceId,
            pipelineId: stage.pipelineId,
            stageId: stage.id,
            title: input.title,
            value: input.value,
            currency: input.currency,
            contactId: input.contactId ?? null,
            companyId: input.companyId ?? null,
            ownerId,
            expectedCloseDate: input.expectedCloseDate ?? null,
            description: input.description ?? null,
            tags: serializeTags(input.tags) ?? "[]",
            closedAt: stage.kind === "OPEN" ? null : now,
            stageChangedAt: now,
          },
        });
        await tx.stageHistory.create({
          data: {
            dealId: deal.id,
            stageId: stage.id,
            fromStageId: null,
            changedById: auth.userId,
            changedAt: now,
          },
        });
        return deal;
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "deal.created",
        entityType: "deal",
        entityId: created.id,
        metadata: { title: created.title, value: created.value },
      });

      const row = await loadDeal(auth.workspaceId, created.id);
      return reply.status(201).send(await serializeDeal(auth.workspaceId, row));
    },
  );

  app.get(
    "/deals/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["deals"],
        summary: "Fetch a single deal with momentum",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      return serializeDeal(auth.workspaceId, await loadDeal(auth.workspaceId, id));
    },
  );

  app.patch(
    "/deals/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["deals"],
        summary: "Update a deal, including stage transitions",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadDeal(auth.workspaceId, id);
      const input = parseOrThrow(dealPatchSchema, request.body);
      const now = new Date();

      const data: Prisma.DealUncheckedUpdateManyInput = {};
      let transition: { fromStageId: string; to: StageShape } | null = null;

      if (input.stageId !== undefined && input.stageId !== existing.stageId) {
        const nextStage = await requireStage(auth.workspaceId, input.stageId);
        transition = { fromStageId: existing.stageId, to: nextStage };
        data.stageId = nextStage.id;
        data.pipelineId = nextStage.pipelineId;
        data.stageChangedAt = now;
        data.closedAt = nextStage.kind === "OPEN" ? null : now;
      }

      if (input.title !== undefined) data.title = input.title;
      if (input.value !== undefined) data.value = input.value;
      if (input.currency !== undefined) data.currency = input.currency;
      if (input.contactId !== undefined) {
        if (input.contactId) await requireContact(auth.workspaceId, input.contactId);
        data.contactId = input.contactId ?? null;
      }
      if (input.companyId !== undefined) {
        if (input.companyId) await requireCompany(auth.workspaceId, input.companyId);
        data.companyId = input.companyId ?? null;
      }
      if (input.expectedCloseDate !== undefined) {
        data.expectedCloseDate = input.expectedCloseDate ?? null;
      }
      if (input.description !== undefined) data.description = input.description ?? null;
      if (input.tags !== undefined) data.tags = serializeTags(input.tags) ?? "[]";
      if (input.ownerId !== undefined) {
        data.ownerId = await resolveOwnerId(auth.workspaceId, input.ownerId, auth.userId);
      }

      const applied = await prisma.$transaction(async (tx) => {
        if (!transition) {
          await tx.deal.update({ where: { id: existing.id }, data });
          return true;
        }
        // Conditional on the deal still being in the stage we read: when a concurrent
        // request already moved it, this update matches nothing and no history is written.
        const moved = await tx.deal.updateMany({
          where: {
            id: existing.id,
            workspaceId: auth.workspaceId,
            stageId: transition.fromStageId,
          },
          data,
        });
        if (moved.count === 1) {
          await tx.stageHistory.create({
            data: {
              dealId: existing.id,
              stageId: transition.to.id,
              fromStageId: transition.fromStageId,
              changedById: auth.userId,
              changedAt: now,
            },
          });
          return true;
        }
        return false;
      });

      if (applied) {
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "deal.updated",
          entityType: "deal",
          entityId: existing.id,
        });
        if (transition) {
          await audit({
            workspaceId: auth.workspaceId,
            actorId: auth.userId,
            action: "deal.stage_changed",
            entityType: "deal",
            entityId: existing.id,
            metadata: { from: existing.stage.name, to: transition.to.name },
          });
        }
      }

      const row = await loadDeal(auth.workspaceId, existing.id);
      return serializeDeal(auth.workspaceId, row);
    },
  );

  app.patch(
    "/deals/:id/stage",
    {
      preHandler: authenticate,
      schema: {
        tags: ["deals"],
        summary: "Move a deal to another stage",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadDeal(auth.workspaceId, id);
      const { stageId } = parseOrThrow(stageMoveSchema, request.body);

      if (stageId === existing.stageId) {
        return serializeDeal(auth.workspaceId, existing);
      }

      const stage = await requireStage(auth.workspaceId, stageId);
      const now = new Date();
      const closedAt = stage.kind === "OPEN" ? null : now;

      const applied = await prisma.$transaction(async (tx) => {
        // Conditional on the deal still being in the stage we read: concurrent duplicate
        // moves to the same stage lose this race and must not insert a second history row.
        const moved = await tx.deal.updateMany({
          where: {
            id: existing.id,
            workspaceId: auth.workspaceId,
            stageId: existing.stageId,
          },
          data: {
            stageId: stage.id,
            pipelineId: stage.pipelineId,
            stageChangedAt: now,
            closedAt,
          },
        });
        if (moved.count === 1) {
          await tx.stageHistory.create({
            data: {
              dealId: existing.id,
              stageId: stage.id,
              fromStageId: existing.stageId,
              changedById: auth.userId,
              changedAt: now,
            },
          });
          return true;
        }
        return false;
      });

      if (applied) {
        await audit({
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: "deal.stage_changed",
          entityType: "deal",
          entityId: existing.id,
          metadata: {
            from: existing.stage.name,
            to: stage.name,
            fromStageId: existing.stageId,
            toStageId: stage.id,
            closed: stage.kind !== "OPEN",
          },
        });
      }

      const row = await loadDeal(auth.workspaceId, existing.id);
      return serializeDeal(auth.workspaceId, row);
    },
  );

  app.get(
    "/deals/:id/history",
    {
      preHandler: authenticate,
      schema: {
        tags: ["deals"],
        summary: "List stage history for a deal",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const deal = await prisma.deal.findFirst({
        where: { id, workspaceId: auth.workspaceId },
        select: { id: true },
      });
      if (!deal) throw notFound("Deal");

      const rows = await prisma.stageHistory.findMany({
        where: { dealId: deal.id },
        include: {
          stage: { select: { name: true } },
          changedBy: { select: userSelect },
        },
        orderBy: { changedAt: "desc" },
      });

      const history: StageHistoryEntry[] = rows.map((row) => ({
        id: row.id,
        stageId: row.stageId,
        stageName: row.stage.name,
        fromStageId: row.fromStageId,
        changedAt: row.changedAt.toISOString(),
        changedBy: toPublicUser(row.changedBy),
      }));
      return history;
    },
  );

  app.delete(
    "/deals/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["deals"],
        summary: "Permanently delete a deal (admins only)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadDeal(auth.workspaceId, id);

      await requireRole(request, "ADMIN");
      await prisma.deal.delete({ where: { id: existing.id } });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "deal.deleted",
        entityType: "deal",
        entityId: existing.id,
        metadata: { title: existing.title },
      });

      return reply.status(204).send();
    },
  );
}
