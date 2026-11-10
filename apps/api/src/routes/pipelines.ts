import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  idSchema,
  stageInputSchema,
  stagePatchSchema,
  type Pipeline,
  type Stage,
  type StageKind,
} from "@meridian/contracts";
import type { Prisma } from "@prisma/client";
import { authenticate, getAuth, requireRole } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/db.js";
import { badRequest, conflict, notFound, parseOrThrow } from "../lib/http.js";

const pipelineBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
});

const pipelinePatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  isDefault: z.boolean().optional(),
});

const reorderSchema = z.object({
  stageIds: z.array(idSchema).min(1).max(200),
});

const idParamsSchema = z.object({ id: idSchema });

const DEFAULT_STAGES: Array<{
  name: string;
  order: number;
  probability: number;
  kind: StageKind;
  targetDays: number;
}> = [
  { name: "Discovery", order: 0, probability: 10, kind: "OPEN", targetDays: 14 },
  { name: "Qualified", order: 1, probability: 25, kind: "OPEN", targetDays: 21 },
  { name: "Proposal", order: 2, probability: 50, kind: "OPEN", targetDays: 14 },
  { name: "Negotiation", order: 3, probability: 75, kind: "OPEN", targetDays: 10 },
  { name: "Won", order: 4, probability: 100, kind: "WON", targetDays: 30 },
  { name: "Lost", order: 5, probability: 0, kind: "LOST", targetDays: 30 },
];

const pipelineInclude = {
  stages: { orderBy: { order: "asc" } },
} satisfies Prisma.PipelineInclude;

type PipelineRow = {
  id: string;
  name: string;
  isDefault: boolean;
  stages: StageRow[];
};

type StageRow = {
  id: string;
  pipelineId: string;
  name: string;
  order: number;
  probability: number;
  kind: string;
  targetDays: number;
};

function toStage(stage: StageRow): Stage {
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

function toPipeline(row: PipelineRow): Pipeline {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    stages: row.stages.map(toStage),
  };
}

async function requirePipeline(workspaceId: string, id: string): Promise<PipelineRow> {
  const row = await prisma.pipeline.findFirst({
    where: { id, workspaceId },
    include: pipelineInclude,
  });
  if (!row) throw notFound("Pipeline");
  return row;
}

async function requireStageRow(workspaceId: string, id: string): Promise<StageRow> {
  const row = await prisma.stage.findFirst({
    where: { id, pipeline: { workspaceId } },
  });
  if (!row) throw notFound("Stage");
  return row;
}

export async function pipelineRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/pipelines",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pipelines"],
        summary: "List pipelines with their ordered stages",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const rows = await prisma.pipeline.findMany({
        where: { workspaceId: auth.workspaceId },
        include: pipelineInclude,
        orderBy: { createdAt: "asc" },
      });
      return rows.map(toPipeline);
    },
  );

  app.post(
    "/pipelines",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pipelines"],
        summary: "Create a pipeline with default stages (admins only)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const input = parseOrThrow(pipelineBodySchema, request.body);
      const existingCount = await prisma.pipeline.count({
        where: { workspaceId: auth.workspaceId },
      });

      const created = await prisma.pipeline.create({
        data: {
          workspaceId: auth.workspaceId,
          name: input.name,
          isDefault: existingCount === 0,
          stages: { create: DEFAULT_STAGES },
        },
        include: pipelineInclude,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "pipeline.created",
        entityType: "pipeline",
        entityId: created.id,
        metadata: { name: created.name },
      });

      return reply.status(201).send(toPipeline(created));
    },
  );

  app.patch(
    "/pipelines/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pipelines"],
        summary: "Rename a pipeline or make it the default (admins only)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await requirePipeline(auth.workspaceId, id);
      const input = parseOrThrow(pipelinePatchSchema, request.body);

      const data: Prisma.PipelineUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.isDefault !== undefined) data.isDefault = input.isDefault;

      const updated = await prisma.$transaction(async (tx) => {
        if (input.isDefault === true) {
          await tx.pipeline.updateMany({
            where: { workspaceId: auth.workspaceId, id: { not: existing.id } },
            data: { isDefault: false },
          });
        }
        return tx.pipeline.update({
          where: { id: existing.id },
          data,
          include: pipelineInclude,
        });
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "pipeline.updated",
        entityType: "pipeline",
        entityId: updated.id,
      });

      return toPipeline(updated);
    },
  );

  app.post(
    "/pipelines/:id/stages",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pipelines"],
        summary: "Append a stage to a pipeline (admins only)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const pipeline = await requirePipeline(auth.workspaceId, id);
      const input = parseOrThrow(stageInputSchema, request.body);

      const maxOrder = await prisma.stage.aggregate({
        where: { pipelineId: pipeline.id },
        _max: { order: true },
      });

      const created = await prisma.stage.create({
        data: {
          pipelineId: pipeline.id,
          name: input.name,
          order: (maxOrder._max.order ?? -1) + 1,
          probability: input.probability,
          kind: input.kind,
          targetDays: input.targetDays,
        },
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "stage.created",
        entityType: "stage",
        entityId: created.id,
        metadata: { pipelineId: pipeline.id, name: created.name },
      });

      return reply.status(201).send(toStage(created));
    },
  );

  app.patch(
    "/stages/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pipelines"],
        summary: "Update a stage (admins only)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await requireStageRow(auth.workspaceId, id);
      const input = parseOrThrow(stagePatchSchema, request.body);

      const data: Prisma.StageUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.probability !== undefined) data.probability = input.probability;
      if (input.kind !== undefined) data.kind = input.kind;
      if (input.targetDays !== undefined) data.targetDays = input.targetDays;

      const kindChanged = input.kind !== undefined && input.kind !== existing.kind;
      const now = new Date();

      const { updated, reconciledDeals } = await prisma.$transaction(async (tx) => {
        const stage = await tx.stage.update({ where: { id: existing.id }, data });
        if (!kindChanged) return { updated: stage, reconciledDeals: 0 };

        const kind = input.kind as StageKind;
        const closed = kind !== "OPEN";
        // closedAt tracks whether the deal is currently closed, so it must follow the
        // stage kind. stageChangedAt is only restarted when moving to a closed kind: the
        // "time in stage" clock marks when the deal entered its closed state, while
        // reopening to OPEN leaves the existing clock untouched so momentum keeps
        // reflecting how long the deal has been sitting in this stage.
        const moved = await tx.deal.updateMany({
          where: { workspaceId: auth.workspaceId, stageId: existing.id },
          data: {
            closedAt: closed ? now : null,
            ...(closed ? { stageChangedAt: now } : {}),
          },
        });
        return { updated: stage, reconciledDeals: moved.count };
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "stage.updated",
        entityType: "stage",
        entityId: updated.id,
        metadata: kindChanged
          ? {
              fromKind: existing.kind,
              toKind: input.kind,
              reconciledDeals,
            }
          : undefined,
      });

      return toStage(updated);
    },
  );

  app.delete(
    "/stages/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pipelines"],
        summary: "Delete a stage and renumber the pipeline (admins only)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await requireStageRow(auth.workspaceId, id);

      await prisma.$transaction(async (tx) => {
        const [dealCount, historyCount, stageCount] = await Promise.all([
          tx.deal.count({ where: { stageId: existing.id } }),
          tx.stageHistory.count({ where: { stageId: existing.id } }),
          tx.stage.count({ where: { pipelineId: existing.pipelineId } }),
        ]);

        if (dealCount > 0) {
          throw conflict("This stage still has deals. Move them before deleting it.", {
            dealCount,
          });
        }
        // Stage history references this stage with onDelete: Restrict; deleting it would
        // either fail or orphan past deal transitions, so the stage is retained instead.
        if (historyCount > 0) {
          throw conflict(
            "This stage is retained to preserve deal history. Stages referenced by past deal transitions cannot be deleted.",
            { historyCount },
          );
        }
        if (stageCount <= 1) {
          throw conflict("A pipeline must keep at least one stage.");
        }

        await tx.stage.delete({ where: { id: existing.id } });
        const remaining = await tx.stage.findMany({
          where: { pipelineId: existing.pipelineId },
          orderBy: { order: "asc" },
          select: { id: true, order: true },
        });
        for (const [index, stage] of remaining.entries()) {
          if (stage.order !== index) {
            await tx.stage.update({ where: { id: stage.id }, data: { order: index } });
          }
        }
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "stage.deleted",
        entityType: "stage",
        entityId: existing.id,
        metadata: { pipelineId: existing.pipelineId, name: existing.name },
      });

      return reply.status(204).send();
    },
  );

  app.post(
    "/pipelines/:id/stages/reorder",
    {
      preHandler: authenticate,
      schema: {
        tags: ["pipelines"],
        summary: "Reorder every stage in a pipeline (admins only)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const pipeline = await requirePipeline(auth.workspaceId, id);
      const { stageIds } = parseOrThrow(reorderSchema, request.body);

      const currentIds = pipeline.stages.map((stage) => stage.id);
      if (stageIds.length !== currentIds.length) {
        throw badRequest("stageIds must contain every stage in the pipeline exactly once");
      }
      const currentSet = new Set(currentIds);
      const requestedSet = new Set(stageIds);
      if (requestedSet.size !== stageIds.length) {
        throw badRequest("stageIds contains duplicate stages");
      }
      for (const stageId of stageIds) {
        if (!currentSet.has(stageId)) {
          throw badRequest("stageIds must contain only stages from this pipeline");
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        for (const [index, stageId] of stageIds.entries()) {
          await tx.stage.update({ where: { id: stageId }, data: { order: -(index + 1) } });
        }
        for (const [index, stageId] of stageIds.entries()) {
          await tx.stage.update({ where: { id: stageId }, data: { order: index } });
        }
        return tx.pipeline.findFirstOrThrow({
          where: { id: pipeline.id },
          include: pipelineInclude,
        });
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "pipeline.stages_reordered",
        entityType: "pipeline",
        entityId: pipeline.id,
      });

      return toPipeline(updated);
    },
  );
}
