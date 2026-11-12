import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000 },
});
