import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    css: false,
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
