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
  // Contracts export TypeScript source; bundle them so `node dist/server.js` works
  // without a source loader in production.
  noExternal: ["@meridian/contracts"],
  splitting: false,
  minify: false,
});
