import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Keep Prisma's runtime and generated client external; they are deployed with node_modules.
  external: ["@prisma/client", ".prisma/client"],
  splitting: false,
  minify: false,
});
