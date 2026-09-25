import "server-only";
import * as client from "openid-client";
import { env } from "@/env";
import { buildSessionData, type RefreshedTokens } from "@/lib/auth/claims";
import { safeReturnTo } from "@/lib/auth/return-to";
import type { SessionData } from "@/lib/session/data";
import type { LoginTransaction } from "@/lib/session/login-transaction";
import { RefreshRejectedError } from "@/lib/auth/errors";

// Why: the scope stays "openid". Every claim the app needs comes from the rag-engine-web
// client scope in the realm, so asking for more scopes would only widen the token.
const SCOPE = "openid";

function redirectUri(): string {
  return `${env.APP_URL}/api/auth/callback`;
}

// Why: no discovery. Discovery would return one set of addresses, but this app needs two.
// The browser must go to the public Keycloak address (authorization and logout), while this
// server calls the internal one (token and keys). Building the server description by hand
// keeps both and makes startup independent of Keycloak being up.
export function buildOidcConfig(): client.Configuration {
  const realm = env.KEYCLOAK_REALM;
  const publicEndpoints = `${env.KEYCLOAK_PUBLIC_URL}/realms/${realm}/protocol/openid-connect`;
  const internalEndpoints = `${env.KEYCLOAK_INTERNAL_URL}/realms/${realm}/protocol/openid-connect`;

  const config = new client.Configuration(
    {
      issuer: `${env.KEYCLOAK_PUBLIC_URL}/realms/${realm}`,
      authorization_endpoint: `${publicEndpoints}/auth`,
      token_endpoint: `${internalEndpoints}/token`,
      jwks_uri: `${internalEndpoints}/certs`,
      end_session_endpoint: `${publicEndpoints}/logout`,
      code_challenge_methods_supported: ["S256"],
    },
    env.KEYCLOAK_CLIENT_ID,
    env.KEYCLOAK_WEB_CLIENT_SECRET,
  );

  // Why: by default the library trusts the ID token because it came over TLS. Locally there
  // is no TLS, so the signature is checked against Keycloak's keys as well.
  client.enableNonRepudiationChecks(config);

  // Why: the library refuses plain http on purpose. It is switched off only when a Keycloak
  // address really is http, which means local development. Over https this line never runs.
  if ([env.KEYCLOAK_PUBLIC_URL, env.KEYCLOAK_INTERNAL_URL].some((url) => url.startsWith("http:"))) {
    client.allowInsecureRequests(config);
  }

  return config;
}

// Why: the configuration keeps a cache of Keycloak's signing keys, so one instance per
// process is shared. globalThis is used because Next.js can load this module more than once.
const globalForOidc = globalThis as typeof globalThis & {
  webOidcConfig?: client.Configuration;
};

export function getOidcConfig(): client.Configuration {
  globalForOidc.webOidcConfig ??= buildOidcConfig();
  return globalForOidc.webOidcConfig;
}

export async function createLoginRequest(
  returnTo: string,
  config: client.Configuration = getOidcConfig(),
): Promise<{ url: URL; transaction: LoginTransaction }> {
  // Why: all three are new for every single login. They must never be reused.
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(),
    scope: SCOPE,
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });

  return { url, transaction: { state, nonce, codeVerifier, returnTo: safeReturnTo(returnTo) } };
}

export async function completeLogin(
  callbackUrl: URL,
  transaction: LoginTransaction,
  config: client.Configuration = getOidcConfig(),
): Promise<SessionData> {
  // Why: the library takes the address it is given at face value. Behind Docker or a proxy
  // the incoming host may not be the public one, so the URL is rebuilt from our own redirect
  // URI plus the query string Keycloak sent (code, state, and possibly an error).
  const currentUrl = new URL(redirectUri());
  currentUrl.search = callbackUrl.search;

  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: transaction.codeVerifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });

  const claims = tokens.claims();
  if (!tokens.refresh_token || !tokens.id_token || !claims) {
    throw new Error("Incomplete token response");
  }

  return buildSessionData(
    {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
    },
    claims,
    Math.floor(Date.now() / 1000),
  );
}

export function buildLogoutUrl(
  idToken: string,
  config: client.Configuration = getOidcConfig(),
): URL {
  return client.buildEndSessionUrl(config, {
    id_token_hint: idToken,
    post_logout_redirect_uri: `${env.APP_URL}/login`,
  });
}

export async function refreshAccessToken(
  refreshToken: string,
  config: client.Configuration = getOidcConfig(),
): Promise<RefreshedTokens> {
  try {
    const tokens = await client.refreshTokenGrant(config, refreshToken);
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
    };
  } catch (error) {
    // Why: invalid_grant is Keycloak saying this refresh token is finished. Only that means
    // "sign in again". Any other failure, such as Keycloak being down, must not sign
    // anybody out.
    if (error instanceof client.ResponseBodyError && error.error === "invalid_grant") {
      throw new RefreshRejectedError("Keycloak rejected the refresh token", { cause: error });
    }
    throw error;
  }
}
