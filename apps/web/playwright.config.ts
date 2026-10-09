import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));

// Why: Playwright does not read .env files. The repo root .env is the one source of
// truth for the demo password, so load it here (apps/web -> ../..) instead of relying
// on a manual export in whatever shell happened to run the tests. Guarded because CI
// usually injects env vars and has no .env file, and loadEnvFile throws if it is missing.
// Variables already set in the shell are not overridden.
const rootEnv = path.resolve(here, "../../.env");
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Why: the spec reads E2E_ALICE_PASSWORD. alice's password is DEMO_USER_PASSWORD in the
// root .env. ??= keeps an explicit E2E_ALICE_PASSWORD override working.
process.env.E2E_ALICE_PASSWORD ??= process.env.DEMO_USER_PASSWORD;

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