import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";
import { makeSession } from "@/lib/session/fixtures";
import { requireAdminRequest, type AdminGuardDeps } from "./guard";

const APP_URL = "http://app.test:3000";

function adminSession(roles: string[] = ["platform-admin"]): Session {
  const data = makeSession();
  return { sid: "sid-1", data: { ...data, user: { ...data.user, roles } } };
}

function request(
  options: { origin?: string | null; method?: string; fetchSite?: string } = {},
): NextRequest {
  const headers = new Headers();
  if (options.origin !== null) {
    headers.set("origin", options.origin ?? APP_URL);
  }
  if (options.fetchSite !== undefined) {
    headers.set("sec-fetch-site", options.fetchSite);
  }
  return new NextRequest(`${APP_URL}/api/admin/kill-switch`, {
    method: options.method ?? "GET",
    headers,
  });
}

function deps(overrides: Partial<AdminGuardDeps> = {}): AdminGuardDeps {
  return { appUrl: APP_URL, getSession: async () => adminSession(), ...overrides };
}

describe("requireAdminRequest", () => {
  it.each([
    ["another origin", "http://evil.example"],
    ["no origin", null],
  ])("refuses a POST with %s before looking at the session", async (_label, origin) => {
    const getSession = vi.fn(async () => adminSession());
    const result = await requireAdminRequest(
      request({ origin, method: "POST" }),
      deps({ getSession }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
    expect(getSession).not.toHaveBeenCalled();
  });

  it("refuses a GET from another origin", async () => {
    const getSession = vi.fn(async () => adminSession());
    const result = await requireAdminRequest(
      request({ origin: "http://evil.example" }),
      deps({ getSession }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
    expect(getSession).not.toHaveBeenCalled();
  });

  it("refuses a cross-site request flagged by Sec-Fetch-Site", async () => {
    const getSession = vi.fn(async () => adminSession());
    const result = await requireAdminRequest(
      request({ fetchSite: "cross-site" }),
      deps({ getSession }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
    expect(getSession).not.toHaveBeenCalled();
  });

  it("allows a same-origin GET that carries no Origin header", async () => {
    const session = adminSession();
    const result = await requireAdminRequest(
      request({ origin: null, fetchSite: "same-origin" }),
      deps({ getSession: async () => session }),
    );
    expect(result).toEqual({ ok: true, session });
  });

  it("refuses when there is no session", async () => {
    const result = await requireAdminRequest(request(), deps({ getSession: async () => null }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("refuses a signed in user without the platform-admin role", async () => {
    const result = await requireAdminRequest(
      request(),
      deps({ getSession: async () => adminSession([]) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  it("allows a signed in admin through", async () => {
    const session = adminSession();
    const result = await requireAdminRequest(request(), deps({ getSession: async () => session }));
    expect(result).toEqual({ ok: true, session });
  });
});
