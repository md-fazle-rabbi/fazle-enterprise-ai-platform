import { NextResponse, type NextRequest } from "next/server";
import { safeReturnTo } from "@/lib/auth/return-to";
import { SESSION_COOKIE_NAMES } from "@/lib/session/cookie";

// Why: a fresh nonce every request is what lets 'strict-dynamic' trust Next.js's own
// framework scripts without domain-allowlisting or falling back to 'unsafe-inline'. Edge
// Runtime only has the Web Crypto API, not node:crypto, hence the global `crypto` and
// `Buffer` rather than an import -- this is Next's own documented pattern for proxy.ts.
function buildCsp(nonce: string, isDev: boolean): string {
  const policy = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'unsafe-inline';
    img-src 'self' data:;
    font-src 'self';
    connect-src 'self'${isDev ? " ws:" : ""};
    frame-ancestors 'none';
    base-uri 'self';
    form-action 'self';
    object-src 'none';
  `;
  return policy.replace(/\s{2,}/g, " ").trim();
}

// Why: an optimistic gate only. It looks for a cookie and nothing else, so it stays fast
// and never touches Redis. It cannot tell a real session from a leftover or made up one,
// which is why every page checks the session itself (getSession). It also now carries the
// per-request CSP nonce on every matched path, login included, so the policy applies
// before a visitor has signed in at all.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const cspHeader = buildCsp(nonce, isDev);

  // Why: /login is in the matcher now (for its own CSP header), so this explicit check is
  // what stops a cookie-less visit to /login from redirecting to itself.
  const isLoginPage = request.nextUrl.pathname === "/login";
  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));

  // Why: forwarded for any future custom <script> that needs the nonce explicitly.
  // Framework-injected scripts pick the nonce up automatically from the response header,
  // nothing in this app needs this yet.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  if (!hasSessionCookie && !isLoginPage) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "returnTo",
      safeReturnTo(request.nextUrl.pathname + request.nextUrl.search),
    );
    const response = NextResponse.redirect(loginUrl);
    response.headers.set("Content-Security-Policy", cspHeader);
    return response;
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", cspHeader);
  return response;
}

// Why: /login is included now; api, Next's own internals and the icons stay excluded. CSP on
// a JSON response or a static asset has nothing to govern, and the icons must load for a
// visitor with no session, or the login page would show no icon in the browser tab. Files
// are listed by exact name on purpose: a pattern like "any path with a dot" would also
// exempt files that should need a session.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
