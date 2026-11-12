import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { atLeast, type Role } from "@meridian/contracts";
import { config } from "../config.js";
import { prisma } from "./db.js";
import { forbidden, unauthorized } from "./http.js";

const SCRYPT_KEYLEN = 64;
const SCRYPT_N = 32_768;

const scrypt = (
  password: string,
  salt: string,
  keylen: number,
  options: ScryptOptions,
) => {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  scryptCallback(password, salt, keylen, options, (error, derived) => {
    if (error) reject(error);
    else resolve(derived);
  });
  return promise;
};

export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: Role;
  email: string;
  name: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const secretKey = new TextEncoder().encode(config.jwtSecret);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    maxmem: 96 * 1024 * 1024,
  })) as Buffer;
  return `scrypt$${SCRYPT_N}$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, nRaw, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !nRaw || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const derived = (await scrypt(password, salt, expected.length, {
    N: Number.parseInt(nRaw, 10),
    maxmem: 96 * 1024 * 1024,
  })) as Buffer;
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function createSession(
  user: { id: string; email: string; name: string },
  workspaceId: string,
  role: Role,
  userAgent?: string,
): Promise<SessionTokens> {
  const accessToken = await new SignJWT({ wid: workspaceId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(config.jwtIssuer)
    .setAudience("meridian-web")
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenTtl}s`)
    .sign(secretKey);

  const refreshToken = randomBytes(48).toString("base64url");
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + config.refreshTokenTtl * 1000),
      userAgent: userAgent?.slice(0, 300) ?? null,
    },
  });

  return { accessToken, refreshToken, expiresIn: config.accessTokenTtl };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function verifyAccessToken(
  token: string,
): Promise<{ userId: string; workspaceId: string }> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: config.jwtIssuer,
      audience: "meridian-web",
    });
    if (!payload.sub || typeof payload.wid !== "string")
      throw new Error("malformed token");
    return { userId: payload.sub, workspaceId: payload.wid };
  } catch {
    throw unauthorized("Your session has expired. Sign in again.");
  }
}

/** Verifies the bearer token and loads a fresh membership, so role changes apply immediately. */
export async function authenticate(request: FastifyRequest): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized();
  const { userId, workspaceId } = await verifyAccessToken(header.slice(7));

  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    include: { user: true },
  });
  if (!membership)
    throw forbidden("You no longer have access to this workspace");

  request.auth = {
    userId,
    workspaceId,
    role: membership.role as Role,
    email: membership.user.email,
    name: membership.user.name,
  };
}

export async function requireRole(
  request: FastifyRequest,
  minimum: Role,
): Promise<void> {
  if (!request.auth) await authenticate(request);
  if (!request.auth || !atLeast(request.auth.role, minimum)) {
    throw forbidden("Your role does not allow this action");
  }
}

export function getAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(config.refreshCookieName, token, {
    path: "/api/v1/auth",
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    maxAge: config.refreshTokenTtl,
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(config.refreshCookieName, { path: "/api/v1/auth" });
}
