import { defineConfig } from "vitest/config";

// Load .env so TEST_DATABASE_URL is available to the tests.
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* absent */
  }
}
// The local .env must not switch the intent classifier on for tests (it would call the real jev API).
// Tests that need it set these variables themselves.
for (const k of ["CLASSIFIER_ENABLED", "CLASSIFIER_MODE", "CLASSIFIER_API_KEY", "CLASSIFIER_THRESHOLDS"]) delete process.env[k];

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});
