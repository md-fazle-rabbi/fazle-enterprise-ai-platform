import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Why: Vite 8 resolves the "@/*" path mapping from tsconfig.json natively, so the
  // vite-tsconfig-paths plugin (and its deprecated tsconfck dependency) is not needed.
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Why: tests must not depend on whatever values the developer's shell exports, and the
    // public/internal Keycloak addresses use different hostnames so a test that mixes them
    // up (calling the internal endpoint from a "browser" context, or vice versa) fails
    // loudly instead of silently passing.
    env: {
      BACKEND_URL: "http://backend.test:8000",
      APP_URL: "http://app.test:3000",
      KEYCLOAK_PUBLIC_URL: "http://idp.test:8080",
      KEYCLOAK_INTERNAL_URL: "http://idp-internal.test:8080",
      KEYCLOAK_WEB_CLIENT_SECRET: "test-client-secret-0123456789",
    },
    // Why: coverage instrumentation plus a fresh jsdom environment per test file put
    // enough load on the machine to make an unrelated render() call exceed its timeout.
    // Sharing one environment per worker removes that contention without weakening
    // per-test correctness: tests still run in their own module context.
    isolate: false,
    // Why: the first render() in a worker pays for loading React, Testing Library and
    // user-event on a cold cache, which took 6-7s here under CPU load. A 15s ceiling
    // absorbs that spike and still catches a genuinely hung test, and it is set once
    // here instead of as a per-test timeout argument scattered across test files.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Why: jsdom workers are CPU-bound. Capping them at half the cores leaves headroom
    // for the machine, so a cold-start spike does not push a test past its timeout.
    maxWorkers: "50%",
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/fixtures.ts", "src/**/fake-redis.ts"],
    },
  },
});
