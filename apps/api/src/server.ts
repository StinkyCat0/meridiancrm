import { buildApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./lib/db.js";

const app = await buildApp();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
