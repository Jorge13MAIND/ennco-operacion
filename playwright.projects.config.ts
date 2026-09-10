import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

process.env.ENNCO_PROJECTS_E2E = "true";
const browser =
  "/home/atlas/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "projects*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.PROJECTS_E2E_BASE_URL ?? "http://localhost:3017",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: existsSync(browser) ? { executablePath: browser } : {},
  },
  webServer: {
    command:
      "ENNCO_PROJECTS_DEMO_WRITE=true ENNCO_DEMO_MODE=true NEXT_PUBLIC_APP_ENV=development NEXT_PUBLIC_APP_URL=http://localhost:3017 npm run dev -- --port 3017",
    url: "http://localhost:3017/operacion/proyectos",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
