import { NextResponse, type NextRequest } from "next/server";
import { safeReturnTo } from "@/lib/auth/return-to";
import { SESSION_COOKIE_NAMES } from "@/lib/session/cookie";

// Why: an optimistic gate only. It looks for a cookie and nothing else, so it stays fast and
// never touches Redis. It cannot tell a real session from a leftover or made up cookie, which
// is why every page checks the session itself (getSession).
export function proxy(request: NextRequest) {
  if (SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name))) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set(
    "returnTo",
    safeReturnTo(request.nextUrl.pathname + request.nextUrl.search),
  );
  return NextResponse.redirect(loginUrl);
}

// Why: the login page and the auth routes must stay reachable without a session.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login).*)"],
};
