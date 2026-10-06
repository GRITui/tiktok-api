import { defineConfig } from "vitest/config";

/** Resolve workspace packages to their TypeScript sources so tests don't need a build. */
export default defineConfig({
  resolve: { conditions: ["@oms/source"] },
  ssr: { resolve: { conditions: ["@oms/source"] } },
  // Each test DB is an in-memory PGlite with migrations applied, which takes ~1s under parallel load.
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
