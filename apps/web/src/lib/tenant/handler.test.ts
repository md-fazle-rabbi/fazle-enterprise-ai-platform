// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";
import { makeSession } from "@/lib/session/fixtures";
import { handleSetTenant, type TenantHandlerDeps } from "./handler";

const APP_URL = "http://app.test:3000";
const TENANT_A = "00000000-0000-0000-0000-000000000001";
const TENANT_B = "00000000-0000-0000-0000-000000000002";

function baseSession(): Session {
  const data = makeSession();
  return { sid: "sid-1", data: { ...data, user: { ...data.user, tenants: [TENANT_A, TENANT_B] } } };
}

function tenantRequest(
  body: string,
  options: { origin?: string | null; contentType?: string } = {},
): NextRequest {
  const { origin = APP_URL, contentType = "application/json" } = options;
  const headers = new Headers({ "content-type": contentType });
  if (origin !== null) {
    headers.set("origin", origin);
  }
  return new NextRequest(`${APP_URL}/api/tenant`, { method: "POST", headers, body });
}

function makeDeps(overrides: Partial<TenantHandlerDeps> = {}) {
  const getSession = vi.fn(async () => baseSession());
  const setCurrentTenant = vi.fn(async () => true);
  const deps: TenantHandlerDeps = { appUrl: APP_URL, getSession, setCurrentTenant, ...overrides };
  return { deps, getSession, setCurrentTenant };
}

describe("handleSetTenant", () => {
  it.each([
    ["another origin", "http://evil.example"],
    ["no origin", null],
  ])("refuses a request with %s before looking at the session", async (_label, origin) => {
    const { deps, getSession } = makeDeps();
    const response = await handleSetTenant(
      tenantRequest(JSON.stringify({ tenantId: TENANT_B }), { origin }),
      deps,
    );
    expect(response.status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON content type", async () => {
    const { deps } = makeDeps();
    const response = await handleSetTenant(
      tenantRequest(JSON.stringify({ tenantId: TENANT_B }), { contentType: "text/plain" }),
      deps,
    );
    expect(response.status).toBe(415);
  });

  it("answers 401 without a session", async () => {
    const { deps, setCurrentTenant } = makeDeps({ getSession: vi.fn(async () => null) });
    const response = await handleSetTenant(
      tenantRequest(JSON.stringify({ tenantId: TENANT_B })),
      deps,
    );
    expect(response.status).toBe(401);
    expect(setCurrentTenant).not.toHaveBeenCalled();
  });

  it.each([
    ["broken JSON", "not json"],
    ["a missing tenantId", "{}"],
    ["a non-UUID tenantId", JSON.stringify({ tenantId: "not-a-uuid" })],
  ])("answers 400 for %s", async (_label, body) => {
    const { deps, setCurrentTenant } = makeDeps();
    const response = await handleSetTenant(tenantRequest(body), deps);
    expect(response.status).toBe(400);
    expect(setCurrentTenant).not.toHaveBeenCalled();
  });

  it("refuses a tenant the token does not grant", async () => {
    const { deps, setCurrentTenant } = makeDeps();
    const response = await handleSetTenant(
      tenantRequest(JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000099" })),
      deps,
    );
    expect(response.status).toBe(403);
    expect(setCurrentTenant).not.toHaveBeenCalled();
  });

  it("switches to a tenant the token grants", async () => {
    const { deps, setCurrentTenant } = makeDeps();
    const response = await handleSetTenant(
      tenantRequest(JSON.stringify({ tenantId: TENANT_B })),
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tenantId: TENANT_B });
    expect(setCurrentTenant).toHaveBeenCalledWith(
      expect.objectContaining({ sid: "sid-1" }),
      TENANT_B,
    );
  });

  it("answers 409 when the session vanished before the switch completed", async () => {
    const { deps } = makeDeps({ setCurrentTenant: vi.fn(async () => false) });
    const response = await handleSetTenant(
      tenantRequest(JSON.stringify({ tenantId: TENANT_B })),
      deps,
    );
    expect(response.status).toBe(409);
  });
});
