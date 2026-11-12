import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import {
  inviteInputSchema,
  memberPatchSchema,
  paginationSchema,
  workspaceUpdateSchema,
  type AuditEntry,
  type Invite,
  type Member,
  type Page,
  type PaginationQuery,
  type PublicUser,
  type Role,
  type WorkspaceSummary,
} from "@meridian/contracts";
import { config } from "../config.js";
import { audit } from "../lib/audit.js";
import { authenticate, getAuth, requireRole, sha256 } from "../lib/auth.js";
import {
  badRequest,
  conflict,
  forbidden,
  likeTerm,
  notFound,
  pageMeta,
  parseOrThrow,
} from "../lib/http.js";
import { prisma } from "../lib/db.js";

type UserRecord = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};
type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  businessType: string;
  timezone: string;
  serviceArea: string | null;
  depotLatitude: number | null;
  depotLongitude: number | null;
  createdAt: Date;
};
type MembershipRecord = {
  id: string;
  role: string;
  createdAt: Date;
  user: UserRecord;
};
type InviteRecord = {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  invitedBy: UserRecord | null;
};

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

function toWorkspaceSummary(workspace: WorkspaceRecord): WorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    currency: workspace.currency,
    businessType: workspace.businessType as WorkspaceSummary["businessType"],
    timezone: workspace.timezone,
    serviceArea: workspace.serviceArea,
    depotLatitude: workspace.depotLatitude,
    depotLongitude: workspace.depotLongitude,
    createdAt: workspace.createdAt.toISOString(),
  };
}

function toMember(membership: MembershipRecord): Member {
  return {
    id: membership.id,
    user: toPublicUser(membership.user),
    role: membership.role as Role,
    joinedAt: membership.createdAt.toISOString(),
  };
}

function toInvite(invite: InviteRecord): Invite {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role as Role,
    expiresAt: invite.expiresAt.toISOString(),
    acceptedAt: invite.acceptedAt ? invite.acceptedAt.toISOString() : null,
    createdAt: invite.createdAt.toISOString(),
    invitedBy: invite.invitedBy ? toPublicUser(invite.invitedBy) : null,
  };
}

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/workspace",
    {
      preHandler: authenticate,
      schema: {
        tags: ["workspace"],
        summary: "Current workspace",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const workspace = await prisma.workspace.findUnique({
        where: { id: auth.workspaceId },
      });
      if (!workspace) throw notFound("Workspace");
      return reply.status(200).send(toWorkspaceSummary(workspace));
    },
  );

  app.patch(
    "/workspace",
    {
      preHandler: authenticate,
      schema: {
        tags: ["workspace"],
        summary: "Rename the workspace or change its currency",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const body = parseOrThrow(workspaceUpdateSchema, request.body);

      const workspace = await prisma.workspace.update({
        where: { id: auth.workspaceId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.currency !== undefined ? { currency: body.currency } : {}),
          ...(body.businessType !== undefined
            ? { businessType: body.businessType }
            : {}),
          ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
          ...(body.serviceArea !== undefined
            ? { serviceArea: body.serviceArea ?? null }
            : {}),
          ...(body.depotLatitude !== undefined
            ? { depotLatitude: body.depotLatitude }
            : {}),
          ...(body.depotLongitude !== undefined
            ? { depotLongitude: body.depotLongitude }
            : {}),
        },
      });

      const changedKeys = Object.keys(body).filter(
        (key) => body[key as keyof typeof body] !== undefined,
      );

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "workspace.updated",
        entityType: "workspace",
        entityId: workspace.id,
        metadata: { fields: changedKeys },
      });

      return reply.status(200).send(toWorkspaceSummary(workspace));
    },
  );

  app.get(
    "/workspace/members",
    {
      preHandler: authenticate,
      schema: {
        tags: ["workspace"],
        summary: "List workspace members",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const memberships = await prisma.membership.findMany({
        where: { workspaceId: auth.workspaceId },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      });
      return reply.status(200).send(memberships.map(toMember));
    },
  );

  app.patch(
    "/workspace/members/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["workspace"],
        summary: "Change a member's role",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const { id } = request.params as { id: string };

      const requestedRole = (request.body as { role?: unknown } | undefined)
        ?.role;
      if (requestedRole === "OWNER") {
        throw conflict(
          "Ownership transfer is not available here. Promote and demote separately.",
        );
      }
      const body = parseOrThrow(memberPatchSchema, request.body);

      const result = await prisma.$transaction(async (tx) => {
        const membership = await tx.membership.findFirst({
          where: { id, workspaceId: auth.workspaceId },
          include: { user: true },
        });
        if (!membership) throw notFound("Member");

        if (membership.role === "OWNER" && auth.role !== "OWNER") {
          throw forbidden("Only an owner can change an owner's role");
        }
        if (membership.userId === auth.userId && membership.role === "OWNER") {
          const owners = await tx.membership.count({
            where: { workspaceId: auth.workspaceId, role: "OWNER" },
          });
          if (owners <= 1) {
            throw conflict(
              "You are the last owner. Promote someone else before changing your role.",
            );
          }
        }

        const updated = await tx.membership.update({
          where: { id: membership.id },
          data: { role: body.role },
          include: { user: true },
        });

        if (membership.role === "OWNER") {
          const owners = await tx.membership.count({
            where: { workspaceId: auth.workspaceId, role: "OWNER" },
          });
          if (owners === 0) {
            throw conflict(
              "You are the last owner. Promote someone else before changing your role.",
            );
          }
        }

        return { updated, previousRole: membership.role };
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "member.role_changed",
        entityType: "membership",
        entityId: result.updated.id,
        metadata: {
          previousRole: result.previousRole,
          role: result.updated.role,
          userId: result.updated.userId,
        },
      });

      return reply.status(200).send(toMember(result.updated));
    },
  );

  app.delete(
    "/workspace/members/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["workspace"],
        summary: "Remove a member from the workspace",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const { id } = request.params as { id: string };

      const removed = await prisma.$transaction(async (tx) => {
        const membership = await tx.membership.findFirst({
          where: { id, workspaceId: auth.workspaceId },
        });
        if (!membership) throw notFound("Member");

        if (membership.userId === auth.userId) {
          throw badRequest("You cannot remove yourself from the workspace");
        }
        if (membership.role === "OWNER") {
          if (auth.role !== "OWNER")
            throw forbidden("Only an owner can remove an owner");
          const owners = await tx.membership.count({
            where: { workspaceId: auth.workspaceId, role: "OWNER" },
          });
          if (owners <= 1) throw conflict("You cannot remove the last owner");
        }

        await tx.membership.delete({ where: { id: membership.id } });

        if (membership.role === "OWNER") {
          const owners = await tx.membership.count({
            where: { workspaceId: auth.workspaceId, role: "OWNER" },
          });
          if (owners === 0) throw conflict("You cannot remove the last owner");
        }

        return {
          id: membership.id,
          userId: membership.userId,
          role: membership.role,
        };
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "member.removed",
        entityType: "membership",
        entityId: removed.id,
        metadata: { userId: removed.userId, role: removed.role },
      });

      return reply.status(204).send();
    },
  );

  app.get(
    "/workspace/invites",
    {
      preHandler: authenticate,
      schema: {
        tags: ["workspace"],
        summary: "List pending and past invites",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");

      const invites = await prisma.invite.findMany({
        where: { workspaceId: auth.workspaceId },
        include: { invitedBy: true },
        orderBy: { createdAt: "desc" },
      });
      return reply.status(200).send(invites.map(toInvite));
    },
  );

  app.post(
    "/workspace/invites",
    {
      preHandler: authenticate,
      schema: {
        tags: ["workspace"],
        summary: "Invite someone to the workspace",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const body = parseOrThrow(inviteInputSchema, request.body);

      const alreadyMember = await prisma.membership.findFirst({
        where: { workspaceId: auth.workspaceId, user: { email: body.email } },
        select: { id: true },
      });
      if (alreadyMember)
        throw conflict("That person is already a member of this workspace");

      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

      const invite = await prisma.invite.upsert({
        where: {
          workspaceId_email: {
            workspaceId: auth.workspaceId,
            email: body.email,
          },
        },
        create: {
          workspaceId: auth.workspaceId,
          email: body.email,
          role: body.role,
          tokenHash: sha256(token),
          expiresAt,
          invitedById: auth.userId,
        },
        update: {
          role: body.role,
          tokenHash: sha256(token),
          expiresAt,
          acceptedAt: null,
          invitedById: auth.userId,
          createdAt: new Date(),
        },
        include: { invitedBy: true },
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "invite.created",
        entityType: "invite",
        entityId: invite.id,
        metadata: { email: invite.email, role: invite.role },
      });

      return reply.status(201).send({
        invite: toInvite(invite),
        token,
        inviteUrl: `${config.webAppUrl}/invite/${token}`,
      });
    },
  );

  app.delete(
    "/workspace/invites/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["workspace"],
        summary: "Revoke a pending invite",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const { id } = request.params as { id: string };

      const invite = await prisma.invite.findFirst({
        where: { id, workspaceId: auth.workspaceId },
      });
      if (!invite) throw notFound("Invite");

      await prisma.invite.delete({ where: { id: invite.id } });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "invite.revoked",
        entityType: "invite",
        entityId: invite.id,
        metadata: { email: invite.email },
      });

      return reply.status(204).send();
    },
  );

  app.get(
    "/workspace/audit",
    {
      preHandler: authenticate,
      schema: {
        tags: ["workspace"],
        summary: "Workspace audit trail",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      await requireRole(request, "ADMIN");
      const query = parseOrThrow(
        paginationSchema,
        request.query,
      ) as PaginationQuery;

      const term = query.q ? likeTerm(query.q) : null;
      const where: Prisma.AuditLogWhereInput = {
        workspaceId: auth.workspaceId,
      };
      if (term) {
        where.OR = [
          { action: { contains: term } },
          { entityType: { contains: term } },
        ];
      }

      const [total, rows] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          include: { actor: true },
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      const data: AuditEntry[] = rows.map((row) => {
        let metadata: Record<string, unknown> | null = null;
        if (row.metadata) {
          try {
            const parsed: unknown = JSON.parse(row.metadata);
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              metadata = parsed as Record<string, unknown>;
            }
          } catch {
            metadata = null;
          }
        }
        return {
          id: row.id,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          metadata,
          actor: row.actor ? toPublicUser(row.actor) : null,
          createdAt: row.createdAt.toISOString(),
        };
      });

      const page: Page<AuditEntry> = {
        data,
        meta: pageMeta(total, query.page, query.pageSize),
      };
      return reply.status(200).send(page);
    },
  );
}
