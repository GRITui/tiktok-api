import { defineConfig } from "vitest/config";

/** Resolve workspace packages to their TypeScript sources so tests don't need a build. */
export default defineConfig({
  resolve: { conditions: ["@oms/source"] },
  ssr: { resolve: { conditions: ["@oms/source"] } },
});
