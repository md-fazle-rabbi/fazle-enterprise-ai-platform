import { NextResponse, type NextRequest } from "next/server";
import { safeReturnTo } from "@/lib/auth/return-to";
import type { CookieSpec } from "@/lib/session/cookie";
import type { SessionData } from "@/lib/session/data";
import type { LoginTransaction, LoginTransactionStore } from "@/lib/session/login-transaction";
import type { RedisSessionStore } from "@/lib/session/store";

export type LoginErrorReason = "expired" | "failed" | "unavailable";

// Why: everything the handlers need comes in through this object. Production fills it with
// Redis and Keycloak (deps.ts), tests fill it with fakes, so the security rules can be tested
// without a browser, Redis or Keycloak.
export type AuthDeps = {
  appUrl: string;
  sessionCookie: CookieSpec;
  loginCookie: CookieSpec;
  loginStore: Pick<LoginTransactionStore, "begin" | "consume">;
  sessionStore: Pick<RedisSessionStore, "create" | "get" | "destroy">;
  createLoginRequest: (returnTo: string) => Promise<{ url: URL; transaction: LoginTransaction }>;
  completeLogin: (callbackUrl: URL, transaction: LoginTransaction) => Promise<SessionData>;
  buildLogoutUrl: (idToken: string) => URL;
};

// Why: auth redirects carry cookies and must never be cached, or a shared cache could hand one
// person's redirect to another.
function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function expireCookie(response: NextResponse, spec: CookieSpec): void {
  response.cookies.set(spec.name, "", { ...spec.options, maxAge: 0 });
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}

export function redirectToLogin(appUrl: string, reason?: LoginErrorReason): NextResponse {
  const url = new URL("/login", appUrl);
  if (reason) {
    url.searchParams.set("error", reason);
  }
  return noStore(NextResponse.redirect(url));
}

export async function handleLogin(request: NextRequest, deps: AuthDeps): Promise<NextResponse> {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const { url, transaction } = await deps.createLoginRequest(returnTo);
  const txid = await deps.loginStore.begin(transaction);

  const response = noStore(NextResponse.redirect(url));
  response.cookies.set(deps.loginCookie.name, txid, deps.loginCookie.options);
  return response;
}

export async function handleCallback(request: NextRequest, deps: AuthDeps): Promise<NextResponse> {
  const fail = (reason: LoginErrorReason) => {
    const response = redirectToLogin(deps.appUrl, reason);
    expireCookie(response, deps.loginCookie);
    return response;
  };

  // Why: the transaction is found only through this browser's login cookie, and consume
  // removes it, so a callback link sent to another browser or used twice finds nothing.
  const txid = request.cookies.get(deps.loginCookie.name)?.value;
  const transaction = txid ? await deps.loginStore.consume(txid) : null;
  if (!transaction) {
    return fail("expired");
  }

  let session: SessionData;
  try {
    session = await deps.completeLogin(new URL(request.url), transaction);
  } catch (error) {
    console.error("Login failed:", describeError(error));
    return fail("failed");
  }

  // Why: a fresh session id at every login rules out session fixation, and an older session in
  // this browser is removed instead of being left in Redis until it expires.
  const previousSid = request.cookies.get(deps.sessionCookie.name)?.value;
  if (previousSid) {
    await deps.sessionStore.destroy(previousSid);
  }
  const sid = await deps.sessionStore.create(session);

  // Why: the target is built on our own address, never on the host the request arrived with.
  const response = noStore(NextResponse.redirect(new URL(transaction.returnTo, deps.appUrl)));
  response.cookies.set(deps.sessionCookie.name, sid, deps.sessionCookie.options);
  expireCookie(response, deps.loginCookie);
  return response;
}

export async function handleLogout(request: NextRequest, deps: AuthDeps): Promise<NextResponse> {
  // Why: a request from another site must not be able to sign a user out. The session cookie
  // is SameSite Lax, and the Origin header has to be this app as well. No Origin is refused.
  if (request.headers.get("origin") !== deps.appUrl) {
    return noStore(new NextResponse("Forbidden", { status: 403 }));
  }

  const sid = request.cookies.get(deps.sessionCookie.name)?.value;
  const session = sid ? await deps.sessionStore.get(sid) : null;
  if (sid) {
    await deps.sessionStore.destroy(sid);
  }

  // Why: 303 turns the form POST into a GET on the next address. Keycloak's logout page needs
  // the ID token as a hint to know which of its own sessions to end.
  const target = session ? deps.buildLogoutUrl(session.idToken) : new URL("/login", deps.appUrl);
  const response = noStore(NextResponse.redirect(target, 303));
  expireCookie(response, deps.sessionCookie);
  return response;
}
