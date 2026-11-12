import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  automationListQuerySchema,
  automationRuleInputSchema,
  automationRulePatchSchema,
  automationRunListQuerySchema,
  idSchema,
  type AutomationRule,
  type AutomationRun,
  type Page,
} from "@meridian/contracts";
import type { Prisma } from "@prisma/client";
import { authenticate, getAuth, requireRole } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/db.js";
import { likeTerm, notFound, pageMeta, parseOrThrow } from "../lib/http.js";
import {
  runDueAutomations,
  toAutomationRule,
  toAutomationRun,
} from "../lib/automation.js";

const idParamsSchema = z.object({ id: idSchema });

const includeRuleName = {
  rule: { select: { name: true } },
} satisfies Prisma.AutomationRunInclude;

async function loadRuleRow(workspaceId: string, id: string) {
  const row = await prisma.automationRule.findFirst({
    where: { id, workspaceId },
  });
  if (!row) throw notFound("Automation rule");
  return row;
}

function ruleOrder(
  sort: string | undefined,
  order: "asc" | "desc",
): Prisma.AutomationRuleOrderByWithRelationInput {
  if (sort === "name") return { name: order };
  if (sort === "runCount") return { runCount: order };
  if (sort === "lastRunAt") return { lastRunAt: order };
  return { createdAt: order };
}

export async function automationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/automations",
    {
      preHandler: authenticate,
      schema: {
        tags: ["automations"],
        summary: "List automation rules with trigger and enabled filters",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<Page<AutomationRule>> => {
      const auth = getAuth(request);
      const query = parseOrThrow(automationListQuerySchema, request.query);

      const where: Prisma.AutomationRuleWhereInput = {
        workspaceId: auth.workspaceId,
        ...(query.trigger ? { trigger: query.trigger } : {}),
        ...(query.enabled ? { enabled: query.enabled === "true" } : {}),
        ...(query.q ? { name: { contains: likeTerm(query.q) } } : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.automationRule.count({ where }),
        prisma.automationRule.findMany({
          where,
          orderBy: ruleOrder(query.sort, query.order),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      return {
        data: rows.map(toAutomationRule),
        meta: pageMeta(total, query.page, query.pageSize),
      };
    },
  );

  app.get(
    "/automations/runs",
    {
      preHandler: authenticate,
      schema: {
        tags: ["automations"],
        summary: "List automation runs, newest first",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<Page<AutomationRun>> => {
      const auth = getAuth(request);
      const query = parseOrThrow(automationRunListQuerySchema, request.query);

      const where: Prisma.AutomationRunWhereInput = {
        workspaceId: auth.workspaceId,
        ...(query.trigger ? { trigger: query.trigger } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.ruleId ? { ruleId: query.ruleId } : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.automationRun.count({ where }),
        prisma.automationRun.findMany({
          where,
          include: includeRuleName,
          orderBy: { createdAt: query.order },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      return {
        data: rows.map(toAutomationRun),
        meta: pageMeta(total, query.page, query.pageSize),
      };
    },
  );

  app.post(
    "/automations/run-due",
    {
      preHandler: authenticate,
      schema: {
        tags: ["automations"],
        summary:
          "Evaluate overdue invoices and upcoming appointments against rules",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");

      const result = await runDueAutomations(auth.workspaceId, auth.userId);

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "automation.run_due",
        entityType: "automation",
        metadata: { evaluated: result.evaluated, run: result.run },
      });

      return result;
    },
  );

  app.post(
    "/automations",
    {
      preHandler: authenticate,
      schema: {
        tags: ["automations"],
        summary: "Create an automation rule",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const input = parseOrThrow(automationRuleInputSchema, request.body);

      const created = await prisma.automationRule.create({
        data: {
          workspaceId: auth.workspaceId,
          name: input.name,
          description: input.description ?? null,
          trigger: input.trigger,
          conditions: JSON.stringify(input.conditions),
          actions: JSON.stringify(input.actions),
          enabled: input.enabled,
        },
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "automation.created",
        entityType: "automation",
        entityId: created.id,
        metadata: { name: created.name, trigger: created.trigger },
      });

      return reply.status(201).send(toAutomationRule(created));
    },
  );

  app.get(
    "/automations/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["automations"],
        summary: "Fetch an automation rule",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<AutomationRule> => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      return toAutomationRule(await loadRuleRow(auth.workspaceId, id));
    },
  );

  app.patch(
    "/automations/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["automations"],
        summary: "Update an automation rule",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<AutomationRule> => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadRuleRow(auth.workspaceId, id);
      const input = parseOrThrow(automationRulePatchSchema, request.body);

      const data: Prisma.AutomationRuleUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined)
        data.description = input.description ?? null;
      if (input.trigger !== undefined) data.trigger = input.trigger;
      if (input.conditions !== undefined)
        data.conditions = JSON.stringify(input.conditions);
      if (input.actions !== undefined)
        data.actions = JSON.stringify(input.actions);
      if (input.enabled !== undefined) data.enabled = input.enabled;

      const updated = await prisma.automationRule.update({
        where: { id: existing.id },
        data,
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "automation.updated",
        entityType: "automation",
        entityId: updated.id,
      });

      return toAutomationRule(updated);
    },
  );

  app.delete(
    "/automations/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["automations"],
        summary: "Delete an automation rule and its run history",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const { id } = parseOrThrow(idParamsSchema, request.params);
      const existing = await loadRuleRow(auth.workspaceId, id);

      await prisma.automationRule.delete({ where: { id: existing.id } });
      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "automation.deleted",
        entityType: "automation",
        entityId: existing.id,
        metadata: { name: existing.name },
      });

      return reply.status(204).send();
    },
  );
}
