// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";
import type { AuthedFetchDeps } from "@/lib/auth/authed-fetch";
import { makeSession } from "@/lib/session/fixtures";
import {
  handleGetReviewQueue,
  handleResolveReviewItem,
  type ReviewQueueHandlerDeps,
} from "./handler";

const APP_URL = "http://app.test:3000";
const ITEM_ID = "11111111-1111-4111-8111-111111111111";

// Derived from the real dependency so the mock can never drift from its signature.
type BackendFetch = AuthedFetchDeps["backendFetch"];

function mockBackend(response?: Response) {
  const fn = vi.fn<BackendFetch>();
  if (response) {
    fn.mockResolvedValue(response);
  }
  return fn;
}

function adminSession(
  currentTenantId: string | null = "00000000-0000-0000-0000-000000000001",
): Session {
  const data = makeSession();
  return {
    sid: "sid-1",
    data: { ...data, user: { ...data.user, roles: ["platform-admin"] }, currentTenantId },
  };
}

function reviewRequest(
  method: string,
  path: string,
  options: { body?: string; contentType?: string; origin?: string } = {},
): NextRequest {
  const headers = new Headers({ origin: options.origin ?? APP_URL });
  if (options.contentType) {
    headers.set("content-type", options.contentType);
  }
  return new NextRequest(`${APP_URL}${path}`, { method, headers, body: options.body });
}

function jsonPost(path: string, body: string): NextRequest {
  return reviewRequest("POST", path, { contentType: "application/json", body });
}

function makeDeps(
  backendFetch: BackendFetch,
  overrides: Partial<ReviewQueueHandlerDeps> = {},
): ReviewQueueHandlerDeps {
  const now = makeSession().accessTokenExpiresAt - 600;
  return {
    appUrl: APP_URL,
    getSession: async () => adminSession(),
    authedFetchDeps: {
      sessionStore: { update: vi.fn(), destroy: vi.fn() },
      refreshTokens: vi.fn(),
      backendFetch,
      nowSeconds: () => now,
    },
    ...overrides,
  };
}

describe("handleGetReviewQueue", () => {
  it("returns the backend's list, tagged as tenant selected", async () => {
    const item = {
      id: ITEM_ID,
      question: "q",
      answer: "a",
      flag_reasons: ["output_pii"],
      status: "pending",
    };
    const backendFetch = mockBackend(Response.json([item]));
    const response = await handleGetReviewQueue(
      reviewRequest("GET", "/api/admin/review-queue"),
      makeDeps(backendFetch),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tenantSelected: true, items: [item] });
  });

  it("refuses a request from another origin", async () => {
    const backendFetch = mockBackend();
    const response = await handleGetReviewQueue(
      reviewRequest("GET", "/api/admin/review-queue", { origin: "http://evil.example" }),
      makeDeps(backendFetch),
    );
    expect(response.status).toBe(403);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("skips the backend call and reports no tenant selected", async () => {
    const backendFetch = mockBackend();
    const response = await handleGetReviewQueue(
      reviewRequest("GET", "/api/admin/review-queue"),
      makeDeps(backendFetch, { getSession: async () => adminSession(null) }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tenantSelected: false, items: [] });
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("reports a bad answer from the backend without guessing at its shape", async () => {
    const backendFetch = mockBackend(Response.json({ unexpected: true }));
    const response = await handleGetReviewQueue(
      reviewRequest("GET", "/api/admin/review-queue"),
      makeDeps(backendFetch),
    );
    expect(response.status).toBe(502);
  });
});

describe("handleResolveReviewItem", () => {
  it("resolves with the given note", async () => {
    const backendFetch = mockBackend(
      Response.json({
        id: ITEM_ID,
        question: "q",
        answer: "a",
        flag_reasons: [],
        status: "reviewed",
      }),
    );
    const response = await handleResolveReviewItem(
      jsonPost(`/api/admin/review-queue/${ITEM_ID}`, JSON.stringify({ note: "false positive" })),
      makeDeps(backendFetch),
      ITEM_ID,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("reviewed");

    expect(backendFetch).toHaveBeenCalledOnce();
    const [path, init] = backendFetch.mock.lastCall ?? [];
    expect(path).toBe(`/review-queue/${ITEM_ID}/resolve`);
    expect(JSON.parse(String(init?.body))).toEqual({ note: "false positive" });
  });

  it("refuses an item id that is not a UUID", async () => {
    const backendFetch = mockBackend();
    const response = await handleResolveReviewItem(
      jsonPost("/api/admin/review-queue/not-a-uuid", "{}"),
      makeDeps(backendFetch),
      "not-a-uuid",
    );
    expect(response.status).toBe(400);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("refuses to resolve with no workspace selected", async () => {
    const backendFetch = mockBackend();
    const response = await handleResolveReviewItem(
      jsonPost(`/api/admin/review-queue/${ITEM_ID}`, "{}"),
      makeDeps(backendFetch, { getSession: async () => adminSession(null) }),
      ITEM_ID,
    );
    expect(response.status).toBe(409);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("passes through a 404 from the backend", async () => {
    const backendFetch = mockBackend(new Response(null, { status: 404 }));
    const response = await handleResolveReviewItem(
      jsonPost(`/api/admin/review-queue/${ITEM_ID}`, "{}"),
      makeDeps(backendFetch),
      ITEM_ID,
    );
    expect(response.status).toBe(404);
  });

  it("refuses a non-admin", async () => {
    const backendFetch = mockBackend();
    const response = await handleResolveReviewItem(
      jsonPost(`/api/admin/review-queue/${ITEM_ID}`, "{}"),
      makeDeps(backendFetch, {
        getSession: async () => {
          const data = makeSession();
          return { sid: "sid-1", data: { ...data, user: { ...data.user, roles: [] } } };
        },
      }),
      ITEM_ID,
    );
    expect(response.status).toBe(403);
    expect(backendFetch).not.toHaveBeenCalled();
  });
});
