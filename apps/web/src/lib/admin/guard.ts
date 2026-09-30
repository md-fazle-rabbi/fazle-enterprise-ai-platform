import type { NextRequest } from "next/server";
import type { Session } from "@/lib/auth/session";

const ADMIN_ROLE = "platform-admin";
const NO_STORE = { "Cache-Control": "no-store" };
const SAFE_METHODS = new Set(["GET", "HEAD"]);

export type AdminGuardDeps = {
  appUrl: string;
  getSession: () => Promise<Session | null>;
};

export type AdminGuardResult = { ok: true; session: Session } | { ok: false; response: Response };

function refuse(status: number, message: string): Response {
  return Response.json({ message }, { status, headers: NO_STORE });
}

// Why: shared by every /api/admin/* route, so the Fetch-Metadata, Origin, session and role
// checks are written and tested once. /api/chat and /api/tenant each wrote this inline; a
// third route copying it again was the signal to pull it out.
export async function requireAdminRequest(
  request: NextRequest,
  deps: AdminGuardDeps,
): Promise<AdminGuardResult> {
  // Why: Sec-Fetch-Site is set by the browser and cannot be forged from page JavaScript.
  // Admin API calls only ever come from our own pages, so anything but same-origin is
  // refused. Clients that do not send it (curl, older browsers) fall through to the
  // Origin check below.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    return { ok: false, response: refuse(403, "Refused") };
  }

  // Why: browsers omit Origin on same-origin GET/HEAD, so a missing Origin is fine for a
  // safe method. Any state-changing method must carry an exact match, and a present but
  // foreign Origin is refused for every method.
  const origin = request.headers.get("origin");
  const originOk = origin === null ? SAFE_METHODS.has(request.method) : origin === deps.appUrl;
  if (!originOk) {
    return { ok: false, response: refuse(403, "Refused") };
  }

  const session = await deps.getSession();
  if (!session) {
    return { ok: false, response: refuse(401, "Not signed in") };
  }
  if (!session.data.user.roles.includes(ADMIN_ROLE)) {
    return { ok: false, response: refuse(403, "platform-admin role required") };
  }
  return { ok: true, session };
}
