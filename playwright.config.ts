import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3200);

/**
 * E2E runs against a production build (`npm run build` first) with its own throw-away PGlite database
 * (.data/e2e-pglite), so it never touches your dev data.
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx tsx scripts/e2e-setup.ts && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { PGLITE_DIR: ".data/e2e-pglite", DATABASE_URL: "", ADMIN_USERNAME: "e2e-admin", ADMIN_PASSWORD: "e2e-admin-password", KB_DIR: "./kb" },
  },
});
