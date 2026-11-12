import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

/** Rebuilds the isolated test database once per test run using the committed schema. */
export function setup(): void {
  const testDb = resolve(process.cwd(), "prisma/test.db");
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(`${testDb}${suffix}`, { force: true });
  }
  execFileSync(
    "npx",
    ["--no-install", "prisma", "db", "push", "--skip-generate"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: "file:./test.db" },
      stdio: "pipe",
    },
  );
}

export function teardown(): void {
  const testDb = resolve(process.cwd(), "prisma/test.db");
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(`${testDb}${suffix}`, { force: true });
  }
}
