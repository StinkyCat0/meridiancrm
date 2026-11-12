import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

let configured: Promise<void> | null = null;

/**
 * SQLite pragmas the app relies on: WAL keeps readers from blocking the writer,
 * the busy timeout turns lock contention into a short wait, and foreign keys
 * enforce the workspace chains the schema declares. Prisma already enables
 * foreign keys per connection, but setting them here is harmless and explicit.
 * Idempotent: callers may invoke this on every boot; the promise is cached and
 * failures are logged rather than thrown so a missing pragma never blocks boot.
 */
export function configureDatabase(): Promise<void> {
  configured ??= (async () => {
    // journal_mode reports the resulting mode as a row, so it needs queryRaw.
    try {
      await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL");
    } catch (error) {
      console.error("database configuration failed: PRAGMA journal_mode=WAL", error);
    }
    try {
      await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000");
    } catch (error) {
      console.error("database configuration failed: PRAGMA busy_timeout=5000", error);
    }
    try {
      await prisma.$executeRawUnsafe("PRAGMA foreign_keys=ON");
    } catch (error) {
      console.error("database configuration failed: PRAGMA foreign_keys=ON", error);
    }
  })();
  return configured;
}
