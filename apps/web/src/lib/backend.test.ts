// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { isBackendReachable } from "./backend";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isBackendReachable", () => {
  it("is true when the backend answers 2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await expect(isBackendReachable()).resolves.toBe(true);
  });

  it("is false when the backend answers 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    await expect(isBackendReachable()).resolves.toBe(false);
  });

  it("is false when the connection fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(isBackendReachable()).resolves.toBe(false);
  });

  it("asks /health on the configured backend with no cache and a timeout", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await isBackendReachable();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.test:8000/health",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
  });
});
