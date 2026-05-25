import { defineConfig, devices } from "@playwright/test";

// Local-only XSS regression suite for frontend/index.html.
// Serves the static file via Playwright's built-in webServer (file:// breaks
// fetch interception for absolute paths like /api/agents).
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
