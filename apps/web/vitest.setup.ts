import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Why: `server-only` throws on purpose outside a React Server Components build. Vitest is
// not one, so it is replaced with an empty module. Real builds still enforce it.
vi.mock("server-only", () => ({}));

// Why: without globals enabled, Testing Library does not unmount between tests by itself.
afterEach(() => {
  cleanup();
});
