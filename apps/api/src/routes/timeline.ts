import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  idSchema,
  type CustomerTimeline,
  type TimelineEntry,
  type TimelineEntryKind,
} from "@meridian/contracts";
import type { Prisma } from "@prisma/client";
import { authenticate, getAuth } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import { notFound, parseOrThrow } from "../lib/http.js";
import { customerSelect, toCustomerSummary } from "../lib/service-ops.js";

const paramsSchema = z.object({ id: idSchema });
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(80),
});

export async function timelineRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/companies/:id/timeline",
    {
      preHandler: authenticate,
      schema: {
        tags: ["companies"],
        summary: "Merge a customer's activities, messages, jobs and money into one timeline",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request): Promise<CustomerTimeline> => {
      const auth = getAuth(request);
      const { id } = parseOrThrow(paramsSchema, request.params);
      const { limit } = parseOrThrow(querySchema, request.query);

      const customer = await prisma.company.findFirst({
        where: { id, workspaceId: auth.workspaceId },
        select: customerSelect,
      });
      if (!customer) throw notFound("Customer");

      const scope = { workspaceId: auth.workspaceId };
      const activityWhere: Prisma.ActivityWhereInput = {
        workspaceId: auth.workspaceId,
        OR: [
          { companyId: id },
          { contact: { companyId: id } },
          { deal: { companyId: id } },
        ],
      };
      const communicationWhere: Prisma.CommunicationWhereInput = {
        workspaceId: auth.workspaceId,
        OR: [
          { customerId: id },
          { contact: { companyId: id } },
          { job: { customerId: id } },
        ],
      };

      const [
        activities,
        communications,
        jobs,
        estimates,
        invoices,
        payments,
        activityCount,
        communicationCount,
        jobCount,
        estimateCount,
        invoiceCount,
        paymentCount,
      ] = await Promise.all([
        prisma.activity.findMany({
          where: activityWhere,
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            completedAt: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit,
        }),
        prisma.communication.findMany({
          where: communicationWhere,
          select: {
            id: true,
            channel: true,
            direction: true,
            status: true,
            subject: true,
            body: true,
            occurredAt: true,
          },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          take: limit,
        }),
        prisma.job.findMany({
          where: { ...scope, customerId: id },
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            scheduledStart: true,
            completedAt: true,
            createdAt: true,
            total: true,
          },
          orderBy: [{ scheduledStart: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: limit,
        }),
        prisma.estimate.findMany({
          where: { ...scope, customerId: id },
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            issuedAt: true,
            createdAt: true,
            total: true,
          },
          orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: limit,
        }),
        prisma.invoice.findMany({
          where: { ...scope, customerId: id },
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            issuedAt: true,
            createdAt: true,
            amount: true,
          },
          orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: limit,
        }),
        prisma.payment.findMany({
          where: { ...scope, invoice: { customerId: id } },
          select: {
            id: true,
            invoiceId: true,
            amount: true,
            method: true,
            receivedAt: true,
            invoice: { select: { number: true } },
          },
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          take: limit,
        }),
        prisma.activity.count({ where: activityWhere }),
        prisma.communication.count({ where: communicationWhere }),
        prisma.job.count({ where: { ...scope, customerId: id } }),
        prisma.estimate.count({ where: { ...scope, customerId: id } }),
        prisma.invoice.count({ where: { ...scope, customerId: id } }),
        prisma.payment.count({ where: { ...scope, invoice: { customerId: id } } }),
      ]);

      const items: TimelineEntry[] = [];

      for (const row of activities) {
        items.push({
          id: `activity:${row.id}`,
          kind: "activity",
          at: (row.completedAt ?? row.createdAt).toISOString(),
          title: row.title,
          detail: row.body,
          status: row.type,
          amount: null,
          entityId: row.id,
          href: null,
          channel: null,
        });
      }

      for (const row of communications) {
        items.push({
          id: `communication:${row.id}`,
          kind: "communication",
          at: row.occurredAt.toISOString(),
          title: row.subject ?? `${row.channel} ${row.direction.toLowerCase()}`,
          detail: row.body,
          status: row.status,
          amount: null,
          entityId: row.id,
          href: `/app/inbox?customer=${id}`,
          channel: row.channel,
        });
      }

      for (const row of jobs) {
        items.push({
          id: `job:${row.id}`,
          kind: "job",
          at: (row.scheduledStart ?? row.completedAt ?? row.createdAt).toISOString(),
          title: row.title,
          detail: `Job ${row.number}`,
          status: row.status,
          amount: row.total,
          entityId: row.id,
          href: `/app/schedule?job=${row.id}`,
          channel: null,
        });
      }

      for (const row of estimates) {
        items.push({
          id: `estimate:${row.id}`,
          kind: "estimate",
          at: (row.issuedAt ?? row.createdAt).toISOString(),
          title: row.title,
          detail: `Estimate ${row.number}`,
          status: row.status,
          amount: row.total,
          entityId: row.id,
          href: `/app/estimates?estimate=${row.id}`,
          channel: null,
        });
      }

      for (const row of invoices) {
        items.push({
          id: `invoice:${row.id}`,
          kind: "invoice",
          at: (row.issuedAt ?? row.createdAt).toISOString(),
          title: row.title,
          detail: `Invoice ${row.number}`,
          status: row.status,
          amount: row.amount,
          entityId: row.id,
          href: `/app/invoices?invoice=${row.id}`,
          channel: null,
        });
      }

      for (const row of payments) {
        items.push({
          id: `payment:${row.id}`,
          kind: "payment",
          at: row.receivedAt.toISOString(),
          title: "Payment received",
          detail: `Invoice ${row.invoice.number} · ${row.method.toLowerCase()}`,
          status: null,
          amount: row.amount,
          entityId: row.id,
          href: `/app/invoices?invoice=${row.invoiceId}`,
          channel: null,
        });
      }

      items.sort((a, b) => {
        const byTime = Date.parse(b.at) - Date.parse(a.at);
        if (byTime !== 0) return byTime;
        if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      });

      const counts: Record<TimelineEntryKind, number> = {
        activity: activityCount,
        communication: communicationCount,
        job: jobCount,
        estimate: estimateCount,
        invoice: invoiceCount,
        payment: paymentCount,
      };

      return {
        customer: toCustomerSummary(customer),
        items: items.slice(0, limit),
        counts,
      };
    },
  );
}
