import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Why: tests must not depend on whatever BACKEND_URL the developer's shell exports.
    env: { BACKEND_URL: "http://backend.test:8000" },
    // Why: coverage instrumentation plus a fresh jsdom environment per test file put
    // enough load on the machine to make an unrelated render() call exceed its timeout.
    // Sharing one environment per worker removes that contention without weakening
    // per-test correctness — tests still run in their own module context.
    isolate: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/fixtures.ts", "src/**/fake-redis.ts"],
    },
  },
});