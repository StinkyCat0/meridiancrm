import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  ERROR_CODES,
  websiteIntakeSchema,
  type WebsiteIntakeResponse,
} from "@meridian/contracts";
import { config } from "../config.js";
import { prisma } from "../lib/db.js";
import { AppError, parseOrThrow, unauthorized } from "../lib/http.js";

const serviceUnavailable = (message: string) =>
  new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, message);

/** Constant-time comparison; unequal lengths cannot be compared safely. */
function secretMatches(presented: string, expected: string): boolean {
  const presentedBuffer = Buffer.from(presented);
  const expectedBuffer = Buffer.from(expected);
  if (presentedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(presentedBuffer, expectedBuffer);
}

function splitName(name: string): { firstName: string; lastName: string } {
  const [first = name, ...rest] = name.split(/\s+/).filter(Boolean);
  return {
    firstName: first.slice(0, 80),
    lastName: (rest.join(" ") || "-").slice(0, 80),
  };
}

function dealTitle(subject: string | undefined): string {
  return subject
    ? `Website inquiry: ${subject}`.slice(0, 160)
    : "Website inquiry";
}

function dealDescription(input: {
  name: string;
  email: string;
  source: string;
  message: string;
}): string {
  return [
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Source: ${input.source}`,
    "",
    input.message,
  ]
    .join("\n")
    .slice(0, 5000);
}

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/public/intake",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags: ["public"],
        summary: "Create a lead from the marketing website",
      },
    },
    async (request, reply) => {
      const expectedSecret = config.websiteIntakeSecret;
      if (!expectedSecret) {
        throw serviceUnavailable("Website intake is not configured");
      }

      const header = request.headers["x-meridian-intake-secret"];
      const presented = Array.isArray(header) ? header[0] : header;
      if (!presented || !secretMatches(presented, expectedSecret)) {
        throw unauthorized("Invalid intake secret");
      }

      const input = parseOrThrow(websiteIntakeSchema, request.body);

      const workspace = await prisma.workspace.findUnique({
        where: { slug: config.websiteIntakeWorkspaceSlug },
        select: { id: true, currency: true },
      });
      if (!workspace) {
        throw serviceUnavailable("Website intake workspace is not configured");
      }

      const pipeline = await prisma.pipeline.findFirst({
        where: { workspaceId: workspace.id },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        include: {
          stages: {
            where: { kind: "OPEN" },
            orderBy: { order: "asc" },
            take: 1,
          },
        },
      });
      const stage = pipeline?.stages[0];
      if (!pipeline || !stage) {
        throw serviceUnavailable("Website intake pipeline is not configured");
      }

      const email = input.email.toLowerCase();
      const subject = input.subject?.trim() || undefined;
      const title = dealTitle(subject);
      const description = dealDescription({
        name: input.name,
        email,
        source: input.source,
        message: input.message,
      });

      const deal = await prisma.$transaction(async (tx) => {
        // Prisma cannot express case-insensitive equality on SQLite, so match
        // the email column with COLLATE NOCASE to reuse existing CRM contacts.
        const [match] = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Contact"
          WHERE "workspaceId" = ${workspace.id}
            AND "email" IS NOT NULL
            AND "email" COLLATE NOCASE = ${email}
          ORDER BY "createdAt" ASC
          LIMIT 1
        `;
        let contact = match
          ? await tx.contact.findUniqueOrThrow({ where: { id: match.id } })
          : null;

        if (contact?.archived) {
          contact = await tx.contact.update({
            where: { id: contact.id },
            data: { archived: false },
          });
        } else if (!contact) {
          const { firstName, lastName } = splitName(input.name);
          contact = await tx.contact.create({
            data: {
              workspaceId: workspace.id,
              firstName,
              lastName,
              email,
              tags: "[]",
            },
          });
        }

        const created = await tx.deal.create({
          data: {
            workspaceId: workspace.id,
            pipelineId: pipeline.id,
            stageId: stage.id,
            title,
            value: 0,
            currency: workspace.currency,
            contactId: contact.id,
            description,
            tags: '["website"]',
            stageChangedAt: new Date(),
          },
        });

        await tx.stageHistory.create({
          data: {
            dealId: created.id,
            stageId: stage.id,
            fromStageId: null,
            changedById: null,
          },
        });

        await tx.communication.create({
          data: {
            workspaceId: workspace.id,
            channel: "EMAIL",
            direction: "INBOUND",
            status: "RECEIVED",
            intent: "GENERAL",
            sentiment: "NEUTRAL",
            subject: subject ?? null,
            body: input.message,
            contactId: contact.id,
            provider: "website",
          },
        });

        return created;
      });

      const body: WebsiteIntakeResponse = { id: deal.id };
      return reply.status(201).send(body);
    },
  );
}
