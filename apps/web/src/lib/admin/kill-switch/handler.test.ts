// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";
import { makeSession } from "@/lib/session/fixtures";
import { handleGetKillSwitch, handlePostKillSwitch, type KillSwitchHandlerDeps } from "./handler";
import type { AuthedFetchDeps } from "@/lib/auth/authed-fetch";

const APP_URL = "http://app.test:3000";

type BackendFetch = KillSwitchHandlerDeps["authedFetchDeps"]["backendFetch"];

function mockBackend() {
  return vi.fn<BackendFetch>();
}

function adminSession(): Session {
  const data = makeSession();
  return { sid: "sid-1", data: { ...data, user: { ...data.user, roles: ["platform-admin"] } } };
}

function killSwitchRequest(
  method: string,
  options: { body?: string; contentType?: string; origin?: string } = {},
): NextRequest {
  const headers = new Headers({ origin: options.origin ?? APP_URL });
  if (options.contentType) {
    headers.set("content-type", options.contentType);
  }
  return new NextRequest(`${APP_URL}/api/admin/kill-switch`, {
    method,
    headers,
    body: options.body,
  });
}

function makeDeps(backendFetch: AuthedFetchDeps["backendFetch"]): KillSwitchHandlerDeps {
  // Why: the clock is set well before the fixture token's expiry, so these tests never
  // trigger a refresh. Refresh behaviour is covered in authed-fetch.test.ts.
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
  };
}

describe("handleGetKillSwitch", () => {
  it("returns the backend's status", async () => {
    const backendFetch = mockBackend().mockResolvedValue(Response.json({ active: true }));
    const response = await handleGetKillSwitch(killSwitchRequest("GET"), makeDeps(backendFetch));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ active: true });
  });

  it("refuses a request from another origin", async () => {
    const backendFetch = mockBackend();
    const response = await handleGetKillSwitch(
      killSwitchRequest("GET", { origin: "http://evil.example" }),
      makeDeps(backendFetch),
    );
    expect(response.status).toBe(403);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("reports a bad answer from the backend without guessing at its shape", async () => {
    const backendFetch = mockBackend().mockResolvedValue(Response.json({ unexpected: true }));
    const response = await handleGetKillSwitch(killSwitchRequest("GET"), makeDeps(backendFetch));
    expect(response.status).toBe(502);
  });
});

describe("handlePostKillSwitch", () => {
  it("activates with the given reason", async () => {
    const backendFetch = mockBackend().mockResolvedValue(new Response(null, { status: 200 }));
    const response = await handlePostKillSwitch(
      killSwitchRequest("POST", {
        contentType: "application/json",
        body: JSON.stringify({ action: "activate", reason: "test drill" }),
      }),
      makeDeps(backendFetch),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ active: true });

    const [path, init] = backendFetch.mock.lastCall ?? [];
    expect(path).toBe("/admin/kill-switch/activate");
    expect(JSON.parse(String(init?.body))).toEqual({ reason: "test drill" });
  });

  it("deactivates with no body needed", async () => {
    const backendFetch = mockBackend().mockResolvedValue(new Response(null, { status: 200 }));
    const response = await handlePostKillSwitch(
      killSwitchRequest("POST", {
        contentType: "application/json",
        body: JSON.stringify({ action: "deactivate" }),
      }),
      makeDeps(backendFetch),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ active: false });
  });

  it("refuses an empty reason", async () => {
    const backendFetch = mockBackend();
    const response = await handlePostKillSwitch(
      killSwitchRequest("POST", {
        contentType: "application/json",
        body: JSON.stringify({ action: "activate", reason: "  " }),
      }),
      makeDeps(backendFetch),
    );
    expect(response.status).toBe(400);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("refuses a non-admin", async () => {
    const backendFetch = mockBackend();
    const deps = makeDeps(backendFetch);
    deps.getSession = async () => {
      const data = makeSession();
      return { sid: "sid-1", data: { ...data, user: { ...data.user, roles: [] } } };
    };
    const response = await handlePostKillSwitch(
      killSwitchRequest("POST", {
        contentType: "application/json",
        body: JSON.stringify({ action: "activate", reason: "x" }),
      }),
      deps,
    );
    expect(response.status).toBe(403);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("passes through a refusal from the backend", async () => {
    const backendFetch = mockBackend().mockResolvedValue(new Response(null, { status: 403 }));
    const response = await handlePostKillSwitch(
      killSwitchRequest("POST", {
        contentType: "application/json",
        body: JSON.stringify({ action: "activate", reason: "x" }),
      }),
      makeDeps(backendFetch),
    );
    expect(response.status).toBe(403);
  });
});
