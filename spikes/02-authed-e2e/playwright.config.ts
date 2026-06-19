// Spike 02 — dedicated Playwright config. Kept separate from the root
// playwright.config.ts (testDir tests/e2e) so this authed spike never enters
// the default `pnpm test:e2e` suite. Run explicitly:
//
//   npx playwright test --config spikes/02-authed-e2e/playwright.config.ts
//
// globalSetup mints the session into .auth/super.json; `use.storageState`
// loads it into every test's browser context.

import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: __dirname,
  testMatch: ["**/*.e2e.ts"],
  globalSetup: resolve(__dirname, "global-setup.ts"),
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    storageState: resolve(__dirname, ".auth", "super.json"),
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
