// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoTenantError, NotSignedInError, RefreshRejectedError } from "@/lib/auth/errors";
import { FakeRedis } from "@/lib/session/fake-redis";
import { makeSession } from "@/lib/session/fixtures";
import { RedisSessionStore } from "@/lib/session/store";
import { authedFetch, type AuthedFetchDeps } from "./authed-fetch";

const NOW = 1_800_000_000;
const TENANT_A = "00000000-0000-0000-0000-000000000001";
const TENANT_B = "00000000-0000-0000-0000-000000000002";

function jwt(exp: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256" })}.${encode({ exp, groups: [`/tenants/${TENANT_A}`] })}.sig`;
}

const refreshTokens = vi.fn<AuthedFetchDeps["refreshTokens"]>();
const backendFetch = vi.fn<AuthedFetchDeps["backendFetch"]>();

let redis: FakeRedis;
let store: RedisSessionStore;
let deps: AuthedFetchDeps;

beforeEach(() => {
  redis = new FakeRedis();
  store = new RedisSessionStore(redis, 3_600);
  refreshTokens.mockReset();
  backendFetch.mockReset();
  backendFetch.mockImplementation(async () => Response.json([]));
  deps = { sessionStore: store, refreshTokens, backendFetch, nowSeconds: () => NOW };
});

function session(expiresIn: number, tenants = [TENANT_A, TENANT_B]) {
  const base = makeSession();
  return makeSession({
    accessToken: "old-access",
    accessTokenExpiresAt: NOW + expiresIn,
    user: { ...base.user, tenants },
  });
}

async function signedIn(expiresIn: number) {
  const data = session(expiresIn);
  return { sid: await store.create(data), data };
}

function lastRequest() {
  const call = backendFetch.mock.lastCall;
  const headers = new Headers(call?.[1]?.headers);
  return {
    path: call?.[0],
    authorization: headers.get("authorization"),
    tenant: headers.get("x-tenant-id"),
  };
}

describe("authedFetch", () => {
  it("sends the access token and the first tenant", async () => {
    const { sid, data } = await signedIn(300);
    await authedFetch(deps, sid, data, "/documents");
    expect(lastRequest()).toEqual({
      path: "/documents",
      authorization: "Bearer old-access",
      tenant: TENANT_A,
    });
  });

  it("does not refresh a token that still has time", async () => {
    const { sid, data } = await signedIn(300);
    await authedFetch(deps, sid, data, "/documents");
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it("refreshes first when the token is about to expire, and stores the new tokens", async () => {
    const fresh = jwt(NOW + 600);
    refreshTokens.mockResolvedValue({ accessToken: fresh, refreshToken: "new-refresh" });
    const { sid, data } = await signedIn(10);

    await authedFetch(deps, sid, data, "/documents");

    expect(refreshTokens).toHaveBeenCalledWith("refresh-token");
    expect(lastRequest().authorization).toBe(`Bearer ${fresh}`);
    await expect(store.get(sid)).resolves.toMatchObject({
      accessToken: fresh,
      refreshToken: "new-refresh",
      accessTokenExpiresAt: NOW + 600,
    });
  });

  it("refreshes once and retries after a 401", async () => {
    const fresh = jwt(NOW + 600);
    refreshTokens.mockResolvedValue({ accessToken: fresh });
    backendFetch
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json([]));
    const { sid, data } = await signedIn(300);

    const response = await authedFetch(deps, sid, data, "/documents");

    expect(response.status).toBe(200);
    expect(backendFetch).toHaveBeenCalledTimes(2);
    expect(refreshTokens).toHaveBeenCalledOnce();
    expect(lastRequest().authorization).toBe(`Bearer ${fresh}`);
  });

  it("signs the user out when Keycloak rejects the refresh token", async () => {
    refreshTokens.mockRejectedValue(new RefreshRejectedError("finished"));
    const { sid, data } = await signedIn(10);

    await expect(authedFetch(deps, sid, data, "/documents")).rejects.toBeInstanceOf(
      NotSignedInError,
    );
    await expect(store.get(sid)).resolves.toBeNull();
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("keeps the session when the refresh fails for another reason", async () => {
    refreshTokens.mockRejectedValue(new TypeError("fetch failed"));
    const { sid, data } = await signedIn(10);

    await expect(authedFetch(deps, sid, data, "/documents")).rejects.toThrow("fetch failed");
    await expect(store.get(sid)).resolves.not.toBeNull();
  });

  it("reports a session that vanished during the refresh", async () => {
    refreshTokens.mockResolvedValue({ accessToken: jwt(NOW + 600) });

    await expect(authedFetch(deps, "gone", session(10), "/documents")).rejects.toBeInstanceOf(
      NotSignedInError,
    );
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("does not call the backend for a user without a tenant", async () => {
    await expect(authedFetch(deps, "sid", session(300, []), "/documents")).rejects.toBeInstanceOf(
      NoTenantError,
    );
    expect(backendFetch).not.toHaveBeenCalled();
  });
});
