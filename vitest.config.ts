import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "tests/server/**/*.test.ts"],
    exclude: ["tests/integration/**"],
    testTimeout: 10_000,
  },
});
