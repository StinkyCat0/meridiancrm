import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ERROR_CODES,
  acceptInviteSchema,
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
  websiteExchangeSchema,
  type AuthSession,
  type MeResponse,
  type PublicUser,
  type Role,
  type WorkspaceSummary,
} from "@meridian/contracts";
import { config } from "../config.js";
import { audit } from "../lib/audit.js";
import {
  authenticate,
  clearRefreshCookie,
  createSession,
  getAuth,
  hashPassword,
  setRefreshCookie,
  sha256,
  verifyPassword,
  type SessionTokens,
} from "../lib/auth.js";
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  parseOrThrow,
  unauthorized,
} from "../lib/http.js";
import { prisma } from "../lib/db.js";
import {
  WebsiteSsoError,
  verifyWebsiteToken,
  type WebsiteTokenClaims,
} from "../lib/website-sso.js";

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

const STAGE_SEEDS = [
  {
    name: "Discovery",
    order: 0,
    probability: 10,
    kind: "OPEN",
    targetDays: 14,
  },
  {
    name: "Qualified",
    order: 1,
    probability: 25,
    kind: "OPEN",
    targetDays: 21,
  },
  { name: "Proposal", order: 2, probability: 50, kind: "OPEN", targetDays: 14 },
  {
    name: "Negotiation",
    order: 3,
    probability: 75,
    kind: "OPEN",
    targetDays: 10,
  },
  { name: "Won", order: 4, probability: 100, kind: "WON", targetDays: 30 },
  { name: "Lost", order: 5, probability: 0, kind: "LOST", targetDays: 30 },
] as const;

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

function sessionBody(
  tokens: SessionTokens,
  user: UserRecord,
  workspace: WorkspaceRecord,
  role: Role,
): AuthSession {
  return {
    accessToken: tokens.accessToken,
    expiresIn: tokens.expiresIn,
    user: toPublicUser(user),
    workspace: toWorkspaceSummary(workspace),
    role,
  };
}

function userAgentOf(request: FastifyRequest): string | undefined {
  const agent = request.headers["user-agent"];
  return typeof agent === "string" ? agent : undefined;
}

let dummyPasswordHash: Promise<string> | null = null;

/** Fixed hash verified on unknown emails so login latency does not reveal account existence. */
function dummyHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword("dummy-password-not-used");
  return dummyPasswordHash;
}

function slugBase(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "workspace";
}

async function uniqueSlug(name: string): Promise<string> {
  let slug = slugBase(name);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const existing = await prisma.workspace.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing) return slug;
    slug = `${slugBase(name).slice(0, 55)}-${randomBytes(2).toString("hex")}`;
  }
  return `${slugBase(name).slice(0, 50)}-${randomBytes(4).toString("hex")}`;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/auth/register",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
      schema: {
        tags: ["auth"],
        summary: "Create an account and workspace",
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(registerSchema, request.body);
      const email = body.email.trim().toLowerCase();

      const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing) throw conflict("An account with that email already exists");

      const passwordHash = await hashPassword(body.password);
      const slug = await uniqueSlug(body.workspaceName);

      const { user, workspace } = await prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: { email, name: body.name, passwordHash },
        });
        const createdWorkspace = await tx.workspace.create({
          data: { name: body.workspaceName, slug, currency: "USD" },
        });
        await tx.membership.create({
          data: {
            userId: createdUser.id,
            workspaceId: createdWorkspace.id,
            role: "OWNER",
          },
        });
        await tx.pipeline.create({
          data: {
            workspaceId: createdWorkspace.id,
            name: "Growth",
            isDefault: true,
            stages: { create: STAGE_SEEDS.map((stage) => ({ ...stage })) },
          },
        });
        return { user: createdUser, workspace: createdWorkspace };
      });

      await audit({
        workspaceId: workspace.id,
        actorId: user.id,
        action: "workspace.created",
        entityType: "workspace",
        entityId: workspace.id,
        metadata: { name: workspace.name, slug: workspace.slug },
      });

      const tokens = await createSession(
        user,
        workspace.id,
        "OWNER",
        userAgentOf(request),
      );
      setRefreshCookie(reply, tokens.refreshToken);
      return reply
        .status(201)
        .send(sessionBody(tokens, user, workspace, "OWNER"));
    },
  );

  app.post(
    "/auth/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        summary: "Sign in with email and password",
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(loginSchema, request.body);
      const email = body.email.trim().toLowerCase();

      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          memberships: {
            include: { workspace: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      });
      const storedHash = user?.passwordHash ?? (await dummyHash());
      const passwordOk = await verifyPassword(body.password, storedHash);
      if (!user || !passwordOk) throw unauthorized("Invalid email or password");

      const membership = user.memberships[0];
      if (!membership)
        throw unauthorized("This account is not attached to a workspace");

      const role = membership.role as Role;
      const tokens = await createSession(
        user,
        membership.workspaceId,
        role,
        userAgentOf(request),
      );
      setRefreshCookie(reply, tokens.refreshToken);

      return reply
        .status(200)
        .send(sessionBody(tokens, user, membership.workspace, role));
    },
  );

  app.post(
    "/auth/website",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        summary: "Exchange a Meridian website session for a CRM session",
      },
    },
    async (request, reply) => {
      if (!config.websiteJwtSecret) {
        throw new AppError(
          503,
          ERROR_CODES.SERVICE_UNAVAILABLE,
          "Website SSO is not configured",
        );
      }

      const body = parseOrThrow(websiteExchangeSchema, request.body);

      let claims: WebsiteTokenClaims;
      try {
        claims = await verifyWebsiteToken(body.token, config.websiteJwtSecret);
      } catch (error) {
        if (error instanceof WebsiteSsoError) {
          if (error.reason === "unconfigured") {
            throw new AppError(
              503,
              ERROR_CODES.SERVICE_UNAVAILABLE,
              "Website SSO is not configured",
            );
          }
          if (error.reason === "forbidden") {
            throw forbidden(
              "This website account is not allowed to use the CRM",
            );
          }
          throw unauthorized("This website session is invalid or expired");
        }
        throw error;
      }

      const email = claims.email.trim().toLowerCase();
      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          memberships: {
            include: { workspace: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      });
      const membership = user?.memberships[0];
      if (!user || !membership) {
        throw unauthorized(
          "This website account is not linked to a CRM workspace",
        );
      }

      const role = membership.role as Role;
      const tokens = await createSession(
        user,
        membership.workspaceId,
        role,
        userAgentOf(request),
      );
      setRefreshCookie(reply, tokens.refreshToken);

      await audit({
        workspaceId: membership.workspaceId,
        actorId: user.id,
        action: "auth.website_sso",
        entityType: "user",
        entityId: user.id,
        metadata: { websiteUserId: claims.websiteUserId },
      });

      return reply
        .status(200)
        .send(sessionBody(tokens, user, membership.workspace, role));
    },
  );

  app.post(
    "/auth/refresh",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        summary: "Rotate the refresh cookie and issue a new access token",
      },
    },
    async (request, reply) => {
      const raw = request.cookies[config.refreshCookieName];
      if (!raw) throw unauthorized("No refresh token was provided");

      const now = new Date();
      const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash: sha256(raw) },
        include: { user: true },
      });
      if (!stored) {
        clearRefreshCookie(reply);
        throw unauthorized("Your session has expired. Sign in again.");
      }

      const claim = await prisma.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (claim.count !== 1) {
        await prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        clearRefreshCookie(reply);
        throw unauthorized("Your session has expired. Sign in again.");
      }

      try {
        const membership = await prisma.membership.findFirst({
          where: { userId: stored.userId },
          include: { workspace: true },
          orderBy: { createdAt: "asc" },
        });
        if (!membership)
          throw unauthorized("This account is not attached to a workspace");

        const tokens = await createSession(
          stored.user,
          membership.workspaceId,
          membership.role as Role,
          stored.userAgent ?? userAgentOf(request),
        );
        setRefreshCookie(reply, tokens.refreshToken);
        return reply.status(200).send({
          accessToken: tokens.accessToken,
          expiresIn: tokens.expiresIn,
        });
      } catch (error) {
        await prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        clearRefreshCookie(reply);
        throw error;
      }
    },
  );

  app.post(
    "/auth/logout",
    {
      schema: {
        tags: ["auth"],
        summary: "Revoke the current refresh token and clear the cookie",
      },
    },
    async (request, reply) => {
      const raw = request.cookies[config.refreshCookieName];
      if (raw) {
        await prisma.refreshToken.updateMany({
          where: { tokenHash: sha256(raw), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      clearRefreshCookie(reply);
      return reply.status(204).send();
    },
  );

  app.get(
    "/auth/me",
    {
      preHandler: authenticate,
      schema: {
        tags: ["auth"],
        summary: "Current user, workspace and role",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const [user, workspace, members] = await Promise.all([
        prisma.user.findUnique({ where: { id: auth.userId } }),
        prisma.workspace.findUnique({ where: { id: auth.workspaceId } }),
        prisma.membership.count({ where: { workspaceId: auth.workspaceId } }),
      ]);
      if (!user || !workspace) throw unauthorized();

      const body: MeResponse = {
        user: toPublicUser(user),
        workspace: toWorkspaceSummary(workspace),
        role: auth.role,
        members,
      };
      return reply.status(200).send(body);
    },
  );

  app.patch(
    "/auth/me",
    {
      preHandler: authenticate,
      schema: {
        tags: ["auth"],
        summary: "Update your name or avatar",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const body = parseOrThrow(updateProfileSchema, request.body);

      const user = await prisma.user.update({
        where: { id: auth.userId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.avatarUrl !== undefined
            ? { avatarUrl: body.avatarUrl }
            : {}),
        },
      });

      await audit({
        workspaceId: auth.workspaceId,
        actorId: auth.userId,
        action: "user.profile_updated",
        entityType: "user",
        entityId: auth.userId,
        metadata: {
          fields: Object.keys(body).filter(
            (key) => body[key as keyof typeof body] !== undefined,
          ),
        },
      });

      return reply.status(200).send({ user: toPublicUser(user) });
    },
  );

  app.post(
    "/auth/password",
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        summary: "Change your password and sign out other sessions",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);
      const body = parseOrThrow(changePasswordSchema, request.body);

      const user = await prisma.user.findUnique({ where: { id: auth.userId } });
      if (!user) throw unauthorized();

      const valid = await verifyPassword(
        body.currentPassword,
        user.passwordHash,
      );
      if (!valid) throw unauthorized("Current password is incorrect");

      const passwordHash = await hashPassword(body.newPassword);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      await prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Every refresh token was revoked, including the caller's. Issue a fresh
      // session for the current device so the client can refresh again; the
      // access token it already holds stays valid until it expires.
      const tokens = await createSession(
        user,
        auth.workspaceId,
        auth.role,
        userAgentOf(request),
      );
      setRefreshCookie(reply, tokens.refreshToken);

      await audit({
        workspaceId: auth.workspaceId,
        actorId: user.id,
        action: "user.password_changed",
        entityType: "user",
        entityId: user.id,
        metadata: { otherSessionsRevoked: true },
      });

      return reply.status(204).send();
    },
  );

  app.get(
    "/auth/invite/:token",
    {
      schema: {
        tags: ["auth"],
        summary: "Inspect a workspace invite",
      },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const invite = await prisma.invite.findUnique({
        where: { tokenHash: sha256(token) },
        include: { workspace: true, invitedBy: true },
      });

      if (!invite) throw notFound("Invite");
      if (invite.acceptedAt)
        throw conflict("This invite has already been accepted");
      if (invite.expiresAt.getTime() <= Date.now()) {
        throw new AppError(
          410,
          ERROR_CODES.NOT_FOUND,
          "This invite has expired. Ask an admin for a new one.",
        );
      }

      return reply.status(200).send({
        email: invite.email,
        workspaceName: invite.workspace.name,
        role: invite.role,
        invitedByName: invite.invitedBy?.name ?? null,
      });
    },
  );

  app.post(
    "/auth/accept-invite",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        summary: "Accept an invite and start a session",
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(acceptInviteSchema, request.body);

      const invite = await prisma.invite.findUnique({
        where: { tokenHash: sha256(body.token) },
        include: { workspace: true },
      });
      if (!invite) throw notFound("Invite");
      if (invite.acceptedAt)
        throw conflict("This invite has already been accepted");
      if (invite.expiresAt.getTime() <= Date.now()) {
        throw new AppError(
          410,
          ERROR_CODES.NOT_FOUND,
          "This invite has expired. Ask an admin for a new one.",
        );
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: invite.email },
        select: { id: true },
      });
      if (existingUser) {
        throw conflict(
          "An account with this email already exists. One workspace per account in this version.",
        );
      }

      const name = body.name;
      const password = body.password;
      if (!name || !password) {
        throw badRequest(
          "Name and password are required to accept this invite",
        );
      }
      if (password.length < 10) {
        throw badRequest("Password must be at least 10 characters");
      }

      const passwordHash = await hashPassword(password);
      const role = invite.role as Role;

      const user = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const claim = await tx.invite.updateMany({
          where: { id: invite.id, acceptedAt: null },
          data: { acceptedAt: now },
        });
        if (claim.count !== 1) {
          throw conflict("This invite has already been accepted");
        }

        const created = await tx.user.create({
          data: { email: invite.email, name, passwordHash },
        });
        await tx.membership.create({
          data: {
            userId: created.id,
            workspaceId: invite.workspaceId,
            role: invite.role,
          },
        });
        await tx.auditLog.create({
          data: {
            workspaceId: invite.workspaceId,
            actorId: created.id,
            action: "member.joined",
            entityType: "membership",
            entityId: null,
            metadata: JSON.stringify({
              email: invite.email,
              role: invite.role,
            }),
          },
        });
        return created;
      });

      const tokens = await createSession(
        user,
        invite.workspaceId,
        role,
        userAgentOf(request),
      );
      setRefreshCookie(reply, tokens.refreshToken);

      return reply
        .status(201)
        .send(sessionBody(tokens, user, invite.workspace, role));
    },
  );
}
