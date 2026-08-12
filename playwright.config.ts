import { defineConfig, devices } from "@playwright/test";

export const viewportProjects = [
  { name: "desktop-wide", use: { ...devices["Desktop Chrome HiDPI"], browserName: "chromium" as const } },
  { name: "desktop-standard", use: { ...devices["Desktop Chrome"], browserName: "chromium" as const } },
  { name: "tablet", use: { ...devices["iPad Pro 11"], browserName: "chromium" as const } },
  { name: "mobile-iphone", use: { ...devices["iPhone 15"], browserName: "chromium" as const } },
  { name: "mobile-android", use: { ...devices["Pixel 7"], browserName: "chromium" as const } },
];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
  projects: viewportProjects,
});
