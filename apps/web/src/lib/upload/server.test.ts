// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotSignedInError } from "@/lib/auth/errors";
import type { Session } from "@/lib/auth/session";
import { makeSession } from "@/lib/session/fixtures";
import { BACKEND_TIMEOUT_MS } from "./forward";

const mocks = vi.hoisted(() => ({
  getRedis: vi.fn(),
  createRateLimitRedis: vi.fn(),
  consume: vi.fn(),
  acquire: vi.fn(),
  createSlidingWindowLimiter: vi.fn(),
  createConcurrencyLimiter: vi.fn(),
  getSessionStore: vi.fn(),
  storeGet: vi.fn(),
  authedFetch: vi.fn(),
}));

vi.mock("@/env", () => ({
  env: {
    APP_URL: "http://app.test:3000",
    UPLOAD_RATE_LIMIT_MAX: 7,
    UPLOAD_RATE_LIMIT_WINDOW_SECONDS: 120,
    UPLOAD_MAX_CONCURRENT: 2,
  },
}));
vi.mock("@/lib/redis", () => ({
  getRedis: mocks.getRedis,
  createRateLimitRedis: mocks.createRateLimitRedis,
}));
vi.mock("@/lib/rate-limit/limiter", () => ({
  createSlidingWindowLimiter: mocks.createSlidingWindowLimiter,
  createConcurrencyLimiter: mocks.createConcurrencyLimiter,
}));
vi.mock("@/lib/session", () => ({ getSessionStore: mocks.getSessionStore }));
vi.mock("@/lib/auth/authed-fetch", () => ({ authedFetch: mocks.authedFetch }));
vi.mock("@/lib/auth/oidc", () => ({ refreshAccessToken: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/backend", () => ({ backendFetch: vi.fn() }));

import { getUploadHandlerDeps } from "./server";

const session: Session = { sid: "sid-1", data: makeSession() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRedis.mockResolvedValue({ client: true });
  mocks.createRateLimitRedis.mockReturnValue({ wrapped: true });
  mocks.createSlidingWindowLimiter.mockReturnValue({ consume: mocks.consume });
  mocks.createConcurrencyLimiter.mockReturnValue({ acquire: mocks.acquire });
  mocks.getSessionStore.mockResolvedValue({ get: mocks.storeGet });
});

describe("getUploadHandlerDeps", () => {
  it("touches nothing when it is built, so the Origin check never waits on Redis", () => {
    const deps = getUploadHandlerDeps();
    expect(deps.appUrl).toBe("http://app.test:3000");
    expect(mocks.getRedis).not.toHaveBeenCalled();
    expect(mocks.getSessionStore).not.toHaveBeenCalled();
  });

  it("counts requests with the upload prefix and the limits from the environment", async () => {
    mocks.consume.mockResolvedValue({ allowed: true, remaining: 6 });
    const decision = await getUploadHandlerDeps().limits.consumeRequest("user-1");
    expect(decision).toEqual({ allowed: true, remaining: 6 });
    expect(mocks.consume).toHaveBeenCalledWith("user-1");
    expect(mocks.createSlidingWindowLimiter).toHaveBeenCalledWith({
      redis: { wrapped: true },
      keyPrefix: "web:rl:upload:",
      limit: 7,
      windowMs: 120_000,
    });
  });

  it("takes a slot with the upload prefix, a slot count from the environment and a long TTL", async () => {
    const slot = { release: vi.fn() };
    mocks.acquire.mockResolvedValue(slot);
    expect(await getUploadHandlerDeps().limits.acquireUpload("user-1")).toBe(slot);
    expect(mocks.acquire).toHaveBeenCalledWith("user-1");
    expect(mocks.createConcurrencyLimiter).toHaveBeenCalledWith({
      redis: { wrapped: true },
      keyPrefix: "web:conc:upload:",
      max: 2,
      holderTtlMs: BACKEND_TIMEOUT_MS.pdf + 30_000,
    });
  });

  it("lets a Redis failure reach the caller instead of counting the request as allowed", async () => {
    mocks.getRedis.mockRejectedValue(new Error("connection refused"));
    await expect(getUploadHandlerDeps().limits.consumeRequest("user-1")).rejects.toThrow(
      "connection refused",
    );
    await expect(getUploadHandlerDeps().limits.acquireUpload("user-1")).rejects.toThrow(
      "connection refused",
    );
  });

  it("reads the session again by id and sends the fresh copy to the backend", async () => {
    const fresh = makeSession();
    mocks.storeGet.mockResolvedValue(fresh);
    const response = new Response(null, { status: 201 });
    mocks.authedFetch.mockResolvedValue(response);
    const init = { method: "POST" as const };

    const result = await getUploadHandlerDeps().forward(session, "/ingest", init);

    expect(result).toBe(response);
    expect(mocks.storeGet).toHaveBeenCalledWith("sid-1");
    expect(mocks.authedFetch).toHaveBeenCalledWith(
      expect.objectContaining({ sessionStore: expect.anything() }),
      "sid-1",
      fresh,
      "/ingest",
      init,
    );
  });

  it("signs the user out when the session was removed while the file was read", async () => {
    mocks.storeGet.mockResolvedValue(null);
    await expect(getUploadHandlerDeps().forward(session, "/ingest", {})).rejects.toBeInstanceOf(
      NotSignedInError,
    );
    expect(mocks.authedFetch).not.toHaveBeenCalled();
  });
});
