import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { redirectToLogin, type AuthDeps } from "@/lib/auth/handlers";
import { buildLogoutUrl, completeLogin, createLoginRequest } from "@/lib/auth/oidc";
import {
  getLoginTransactionStore,
  getSessionStore,
  loginCookieSpec,
  sessionCookieSpec,
} from "@/lib/session";

export async function getAuthDeps(): Promise<AuthDeps> {
  return {
    appUrl: env.APP_URL,
    sessionCookie: sessionCookieSpec(),
    loginCookie: loginCookieSpec(),
    loginStore: await getLoginTransactionStore(),
    sessionStore: await getSessionStore(),
    createLoginRequest: (returnTo) => createLoginRequest(returnTo),
    completeLogin: (callbackUrl, transaction) => completeLogin(callbackUrl, transaction),
    buildLogoutUrl: (idToken) => buildLogoutUrl(idToken),
  };
}

// Why: if Redis or Keycloak is down the user sees a message on the login page, not a stack
// trace. Only the message is logged, never an object that could carry tokens.
export function authRoute(
  handler: (request: NextRequest, deps: AuthDeps) => Promise<NextResponse>,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request) => {
    try {
      return await handler(request, await getAuthDeps());
    } catch (error) {
      console.error("Auth route failed:", error instanceof Error ? error.message : "unknown error");
      return redirectToLogin(env.APP_URL, "unavailable");
    }
  };
}
