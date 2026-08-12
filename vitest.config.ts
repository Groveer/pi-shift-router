import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    css: false,
    coverage: {
      provider: "v8",
      include: ["src/router.ts", "src/failover.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
    // Sandbox-compatible worker pool: single thread avoids tinypool
    // "Maximum call stack size exceeded" crashes under the sandbox.
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
