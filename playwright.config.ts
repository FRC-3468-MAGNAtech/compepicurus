import { defineConfig, devices } from "@playwright/test";

// The P18 browser tests: themes x modes keep their blurs (Chromium and WebKit, desktop and phone), the sidebar arrow is
// reachable, and the connection chip never shifts the layout. `npm run test:e2e`.
//
// It starts its own Next server with E2E_THEME_CHECK=1, which switches on the test-only page /e2e/theme-check (the real
// shell + Appearance panel with no login). Set E2E_PROD=1 to test a production build instead of `next dev`.
// First time on a machine: `npx playwright install chromium webkit`.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const prod = process.env.E2E_PROD === "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 } } },
    { name: "chromium-phone", use: { ...devices["Pixel 7"] } },
    { name: "webkit-phone", use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    command: prod ? `npm run build && npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/e2e/theme-check`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: { E2E_THEME_CHECK: "1" },
    stdout: "ignore",
    stderr: "pipe",
  },
});
