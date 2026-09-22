// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginCookie, sessionCookie } from "@/lib/session/cookie";
import { FakeRedis } from "@/lib/session/fake-redis";
import { makeSession } from "@/lib/session/fixtures";
import { LoginTransactionStore } from "@/lib/session/login-transaction";
import { RedisSessionStore } from "@/lib/session/store";
import { handleCallback, handleLogin, handleLogout, type AuthDeps } from "./handlers";

const APP_URL = "http://app.test:3000";
const IDP_LOGIN_URL = "http://idp.test:8080/auth?client_id=fazle-web";
const IDP_LOGOUT_URL = "http://idp.test:8080/logout?id_token_hint=id-token";

const createLoginRequest = vi.fn<AuthDeps["createLoginRequest"]>();
const completeLogin = vi.fn<AuthDeps["completeLogin"]>();

let redis: FakeRedis;
let loginStore: LoginTransactionStore;
let sessionStore: RedisSessionStore;
let deps: AuthDeps;

beforeEach(() => {
  redis = new FakeRedis();
  loginStore = new LoginTransactionStore(redis, 600);
  sessionStore = new RedisSessionStore(redis, 3_600);

  createLoginRequest.mockReset();
  createLoginRequest.mockImplementation(async (returnTo) => ({
    url: new URL(IDP_LOGIN_URL),
    transaction: { state: "state", nonce: "nonce", codeVerifier: "verifier", returnTo },
  }));
  completeLogin.mockReset();
  completeLogin.mockResolvedValue(makeSession());

  deps = {
    appUrl: APP_URL,
    sessionCookie: sessionCookie(APP_URL, 3_600),
    loginCookie: loginCookie(APP_URL, 600),
    loginStore,
    sessionStore,
    createLoginRequest,
    completeLogin,
    buildLogoutUrl: () => new URL(IDP_LOGOUT_URL),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

function request(path: string, init: { cookie?: string; method?: string; origin?: string } = {}) {
  const headers = new Headers();
  if (init.cookie) {
    headers.set("cookie", init.cookie);
  }
  if (init.origin) {
    headers.set("origin", init.origin);
  }
  return new NextRequest(`${APP_URL}${path}`, { method: init.method ?? "GET", headers });
}

// Deliberately another host than APP_URL, as it can look behind Docker or a proxy.
function callbackRequest(cookie: string) {
  return new NextRequest("http://0.0.0.0:3000/api/auth/callback?code=c&state=state", {
    headers: { cookie },
  });
}

async function startLogin(returnTo = "/chat") {
  const response = await handleLogin(request(`/api/auth/login?returnTo=${returnTo}`), deps);
  return response.cookies.get("fazle_login")?.value ?? "";
}

describe("handleLogin", () => {
  it("sends the browser to Keycloak and binds the login to it with a cookie", async () => {
    const response = await handleLogin(request("/api/auth/login?returnTo=/chat"), deps);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(IDP_LOGIN_URL);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.cookies.get("fazle_login");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("stores the transaction so the callback can find it", async () => {
    const txid = await startLogin("/chat");
    await expect(loginStore.consume(txid)).resolves.toMatchObject({ returnTo: "/chat" });
  });

  it("replaces an unsafe return path before asking Keycloak", async () => {
    await handleLogin(request("/api/auth/login?returnTo=//evil.example"), deps);
    expect(createLoginRequest).toHaveBeenCalledWith("/");
  });
});

describe("handleCallback", () => {
  it("turns a valid callback into a session cookie and goes to the return path", async () => {
    const txid = await startLogin("/chat");
    const response = await handleCallback(callbackRequest(`fazle_login=${txid}`), deps);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${APP_URL}/chat`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const sid = response.cookies.get("fazle_sid");
    expect(sid).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 3_600 });
    await expect(sessionStore.get(sid?.value ?? "")).resolves.toEqual(makeSession());
    expect(response.cookies.get("fazle_login")).toMatchObject({ value: "", maxAge: 0 });
    expect(completeLogin.mock.calls[0]?.[0].search).toBe("?code=c&state=state");
    expect(completeLogin.mock.calls[0]?.[1]).toMatchObject({ state: "state" });
  });

  it("sends a browser without a login cookie back to the login page", async () => {
    const response = await handleCallback(callbackRequest("other=1"), deps);
    expect(response.headers.get("location")).toBe(`${APP_URL}/login?error=expired`);
    expect(completeLogin).not.toHaveBeenCalled();
    expect(response.cookies.get("fazle_sid")).toBeUndefined();
  });

  it("refuses a login cookie that matches no transaction", async () => {
    const response = await handleCallback(callbackRequest("fazle_login=made-up"), deps);
    expect(response.headers.get("location")).toBe(`${APP_URL}/login?error=expired`);
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it("works only once per login", async () => {
    const txid = await startLogin();
    const first = await handleCallback(callbackRequest(`fazle_login=${txid}`), deps);
    expect(first.headers.get("location")).toBe(`${APP_URL}/chat`);
    const second = await handleCallback(callbackRequest(`fazle_login=${txid}`), deps);
    expect(second.headers.get("location")).toBe(`${APP_URL}/login?error=expired`);
    expect(completeLogin).toHaveBeenCalledOnce();
  });

  it("shows a failure and creates no session when Keycloak rejects the login", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    completeLogin.mockRejectedValue(new Error("state mismatch"));
    const txid = await startLogin();
    const response = await handleCallback(callbackRequest(`fazle_login=${txid}`), deps);

    expect(response.headers.get("location")).toBe(`${APP_URL}/login?error=failed`);
    expect(response.cookies.get("fazle_sid")).toBeUndefined();
    expect(response.cookies.get("fazle_login")).toMatchObject({ value: "", maxAge: 0 });
    expect(redis.entries.size).toBe(0);
  });

  it("replaces an older session of the same browser", async () => {
    const oldSid = await sessionStore.create(makeSession({ accessToken: "old" }));
    const txid = await startLogin();
    const response = await handleCallback(
      callbackRequest(`fazle_login=${txid}; fazle_sid=${oldSid}`),
      deps,
    );

    const newSid = response.cookies.get("fazle_sid")?.value ?? "";
    expect(newSid).not.toBe(oldSid);
    await expect(sessionStore.get(oldSid)).resolves.toBeNull();
    await expect(sessionStore.get(newSid)).resolves.not.toBeNull();
  });
});

describe("handleLogout", () => {
  it("ends the session, clears the cookie and goes to Keycloak's logout", async () => {
    const sid = await sessionStore.create(makeSession());
    const response = await handleLogout(
      request("/api/auth/logout", { method: "POST", origin: APP_URL, cookie: `fazle_sid=${sid}` }),
      deps,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(IDP_LOGOUT_URL);
    expect(response.cookies.get("fazle_sid")).toMatchObject({ value: "", maxAge: 0 });
    await expect(sessionStore.get(sid)).resolves.toBeNull();
  });

  it("goes to the login page when there is no session", async () => {
    const response = await handleLogout(
      request("/api/auth/logout", { method: "POST", origin: APP_URL }),
      deps,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP_URL}/login`);
  });

  it.each([
    ["another origin", "http://evil.example"],
    ["no origin", undefined],
  ])("refuses a logout request with %s and keeps the session", async (_label, origin) => {
    const sid = await sessionStore.create(makeSession());
    const response = await handleLogout(
      request("/api/auth/logout", { method: "POST", origin, cookie: `fazle_sid=${sid}` }),
      deps,
    );

    expect(response.status).toBe(403);
    await expect(sessionStore.get(sid)).resolves.not.toBeNull();
  });
});
