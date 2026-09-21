// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLogoutUrl, buildOidcConfig, completeLogin, createLoginRequest } from "./oidc";

const ISSUER = "http://idp.test:8080/realms/agent-mesh";
const OIDC_PATH = "/realms/agent-mesh/protocol/openid-connect";
const TOKEN_URL = `http://idp-internal.test:8080${OIDC_PATH}/token`;
const JWKS_URL = `http://idp-internal.test:8080${OIDC_PATH}/certs`;
const REDIRECT_URI = "http://app.test:3000/api/auth/callback";
const SECRET = "test-client-secret-0123456789";
const TENANT_A = "00000000-0000-0000-0000-000000000001";

afterEach(() => {
  vi.unstubAllGlobals();
});

// A throwaway Keycloak signing key. The public half is served as the JWKS.
async function createKey() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const kid = randomUUID();
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  const signIdToken = (nonce: string) =>
    new SignJWT({ nonce, preferred_username: "alice", email: "alice@acme.example" })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(ISSUER)
      .setAudience("fazle-web")
      .setSubject("user-1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  return { jwk, signIdToken };
}

// The access token is only decoded, never verified, by the app, so a fake signature is fine.
function fakeAccessToken(): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 300;
  const payload = { exp, groups: [`/tenants/${TENANT_A}`], realm_access: { roles: [] } };
  return `${encode({ alg: "RS256" })}.${encode(payload)}.signature`;
}

// Replaces fetch with a tiny Keycloak that answers the token and the keys endpoints.
function fakeKeycloak(options: { jwk: JWK; idToken: string; omitRefreshToken: boolean }) {
  const tokenRequests: URLSearchParams[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === TOKEN_URL) {
      tokenRequests.push(new URLSearchParams(init?.body as string | URLSearchParams));
      return Response.json({
        access_token: fakeAccessToken(),
        token_type: "Bearer",
        expires_in: 300,
        id_token: options.idToken,
        ...(options.omitRefreshToken ? {} : { refresh_token: "refresh-token" }),
      });
    }
    if (url === JWKS_URL) {
      return Response.json({ keys: [options.jwk] });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
  return { tokenRequests };
}

async function prepare(
  options: {
    nonceInIdToken?: string;
    signWithOtherKey?: boolean;
    omitRefreshToken?: boolean;
  } = {},
) {
  const config = buildOidcConfig();
  const { transaction } = await createLoginRequest("/chat", config);
  const servedKey = await createKey();
  const signingKey = options.signWithOtherKey ? await createKey() : servedKey;
  const idToken = await signingKey.signIdToken(options.nonceInIdToken ?? transaction.nonce);
  const idp = fakeKeycloak({
    jwk: servedKey.jwk,
    idToken,
    omitRefreshToken: options.omitRefreshToken ?? false,
  });
  return { config, transaction, idp };
}

function callback(query: string): URL {
  // Deliberately another host than the public one, as it would look behind Docker.
  return new URL(`http://0.0.0.0:3000/api/auth/callback?${query}`);
}

describe("createLoginRequest", () => {
  it("builds an authorization request with PKCE, state and nonce", async () => {
    const { url, transaction } = await createLoginRequest("/chat", buildOidcConfig());
    expect(url.origin + url.pathname).toBe(`http://idp.test:8080${OIDC_PATH}/auth`);
    expect(url.searchParams.get("client_id")).toBe("fazle-web");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(transaction.codeVerifier).digest("base64url"),
    );
    expect(url.searchParams.get("state")).toBe(transaction.state);
    expect(url.searchParams.get("nonce")).toBe(transaction.nonce);
    expect(transaction.returnTo).toBe("/chat");
  });

  it("uses fresh values for every login", async () => {
    const config = buildOidcConfig();
    const first = await createLoginRequest("/", config);
    const second = await createLoginRequest("/", config);
    expect(first.transaction.codeVerifier).not.toBe(second.transaction.codeVerifier);
    expect(first.transaction.state).not.toBe(second.transaction.state);
    expect(first.transaction.nonce).not.toBe(second.transaction.nonce);
  });

  it("replaces an unsafe return path with /", async () => {
    const { transaction } = await createLoginRequest("//evil.example", buildOidcConfig());
    expect(transaction.returnTo).toBe("/");
  });
});

describe("buildLogoutUrl", () => {
  it("builds an end session URL on the public Keycloak address", () => {
    const url = buildLogoutUrl("the-id-token", buildOidcConfig());
    expect(url.origin + url.pathname).toBe(`http://idp.test:8080${OIDC_PATH}/logout`);
    expect(url.searchParams.get("id_token_hint")).toBe("the-id-token");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("http://app.test:3000/login");
  });
});

describe("completeLogin", () => {
  it("turns a valid callback into a session, with the canonical redirect URI", async () => {
    const { config, transaction, idp } = await prepare();
    const session = await completeLogin(
      callback(`code=the-code&state=${transaction.state}`),
      transaction,
      config,
    );

    expect(session.user).toMatchObject({ id: "user-1", username: "alice", tenants: [TENANT_A] });
    const request = idp.tokenRequests[0];
    expect(request?.get("grant_type")).toBe("authorization_code");
    expect(request?.get("code")).toBe("the-code");
    expect(request?.get("code_verifier")).toBe(transaction.codeVerifier);
    expect(request?.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(request?.get("client_id")).toBe("fazle-web");
    expect(request?.get("client_secret")).toBe(SECRET);
  });

  it("rejects a wrong state before any token request is made", async () => {
    const { config, transaction, idp } = await prepare();
    await expect(
      completeLogin(callback("code=the-code&state=someone-elses-state"), transaction, config),
    ).rejects.toThrow();
    expect(idp.tokenRequests).toHaveLength(0);
  });

  it("rejects an ID token with a different nonce", async () => {
    const { config, transaction } = await prepare({ nonceInIdToken: "another-nonce" });
    await expect(
      completeLogin(callback(`code=the-code&state=${transaction.state}`), transaction, config),
    ).rejects.toThrow();
  });

  it("rejects an ID token signed with a key Keycloak does not publish", async () => {
    const { config, transaction } = await prepare({ signWithOtherKey: true });
    await expect(
      completeLogin(callback(`code=the-code&state=${transaction.state}`), transaction, config),
    ).rejects.toThrow();
  });

  it("rejects an error response from Keycloak without asking for tokens", async () => {
    const { config, transaction, idp } = await prepare();
    await expect(
      completeLogin(
        callback(`error=access_denied&state=${transaction.state}`),
        transaction,
        config,
      ),
    ).rejects.toThrow();
    expect(idp.tokenRequests).toHaveLength(0);
  });

  it("rejects a token response without a refresh token", async () => {
    const { config, transaction } = await prepare({ omitRefreshToken: true });
    await expect(
      completeLogin(callback(`code=the-code&state=${transaction.state}`), transaction, config),
    ).rejects.toThrow(/Incomplete/);
  });
});
