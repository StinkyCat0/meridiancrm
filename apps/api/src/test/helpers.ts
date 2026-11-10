import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/db.js";

export async function createTestApp(): Promise<FastifyInstance> {
  return buildApp({ logger: false });
}

/** Clears every table. Run in beforeEach so each test starts from a known state. */
export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ name: string }[]>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'
  `;
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  for (const { name } of tables) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${name}"`);
  }
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
}

export interface TestAccount {
  accessToken: string;
  userId: string;
  workspaceId: string;
  email: string;
}

export async function registerAccount(
  app: FastifyInstance,
  overrides: Partial<{
    name: string;
    email: string;
    password: string;
    workspaceName: string;
  }> = {},
): Promise<TestAccount> {
  const payload = {
    name: overrides.name ?? "Test Owner",
    email: overrides.email ?? `owner-${crypto.randomUUID()}@example.com`,
    password: overrides.password ?? "TestPassword123",
    workspaceName: overrides.workspaceName ?? "Test Workspace",
  };
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload });
  if (response.statusCode !== 201) {
    throw new Error(`register failed: ${response.statusCode} ${response.body}`);
  }
  const body = response.json() as {
    accessToken: string;
    user: { id: string };
    workspace: { id: string };
  };
  return {
    accessToken: body.accessToken,
    userId: body.user.id,
    workspaceId: body.workspace.id,
    email: payload.email,
  };
}

export function authHeaders(account: TestAccount): Record<string, string> {
  return { authorization: `Bearer ${account.accessToken}` };
}

export async function getDefaultStageId(workspaceId: string): Promise<string> {
  const pipeline = await prisma.pipeline.findFirstOrThrow({
    where: { workspaceId },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  const first = pipeline.stages[0];
  if (!first) throw new Error("default pipeline has no stages");
  return first.id;
}
