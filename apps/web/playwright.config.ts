import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  testDir: resolve(root, "e2e"),
  testMatch: "**/*.spec.ts",
  outputDir: resolve(root, "test-results"),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3001",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    cwd: root,
    url: "http://localhost:3001/api/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
