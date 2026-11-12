import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./src/test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "file:./test.db",
      JWT_SECRET: "test-secret-that-is-long-enough-for-hs256-signing",
      WEBSITE_JWT_SECRET:
        "test-website-secret-that-is-long-enough-for-hs256-signing",
      SEED_DEMO: "0",
      WEBSITE_INTAKE_SECRET: "test-website-intake-secret",
      WEBSITE_INTAKE_WORKSPACE_SLUG: "test-intake-workspace",
    },
    // SQLite has a single writer; keep suites serial and deterministic.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        "src/worker/**",
        "src/**/*.d.ts",
        "prisma/**",
      ],
      // Deliberately conservative floor: it fails a collapse in coverage without
      // penalising every untested branch. Raise as suites land, never lower.
      thresholds: {
        statements: 20,
        branches: 15,
        functions: 20,
        lines: 20,
      },
    },
  },
});
