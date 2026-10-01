import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

// Why: no webServer entry here. This app needs Postgres, Redis, Keycloak and FastAPI up
// in Docker Compose first, which Playwright cannot start on its own, so `npm run dev` is
// started by hand, the same way every manual check in this build already is.
export default defineConfig({
  testDir: "./e2e",
  // Why: this suite is one real login plus one real generation, both slow and stateful.
  // Running it more than one at a time, or retrying a flaky real-network step, would just
  // hide a real problem behind a second attempt.
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Why: Chromium only. A local showcase doesn't need cross-browser coverage, and it
  // halves the download and run time compared to Playwright's three-browser default.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
