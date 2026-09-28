import type { NextRequest } from "next/server";
import * as z from "zod";
import type { Session } from "@/lib/auth/session";

const requestSchema = z.object({ tenantId: z.guid() });

// Why: everything the handler needs comes in through this object, so the rules can be
// tested without Redis or a browser.
export type TenantHandlerDeps = {
  appUrl: string;
  getSession: () => Promise<Session | null>;
  setCurrentTenant: (session: Session, tenantId: string) => Promise<boolean>;
};

const NO_STORE = { "Cache-Control": "no-store" };

function refuse(status: number, message: string): Response {
  return Response.json({ message }, { status, headers: NO_STORE });
}

export async function handleSetTenant(
  request: NextRequest,
  deps: TenantHandlerDeps,
): Promise<Response> {
  // Why: same CSRF shape as /api/chat and /api/auth/logout — a request from another site
  // must not be able to switch which workspace this user acts as.
  if (request.headers.get("origin") !== deps.appUrl) {
    return refuse(403, "Refused");
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return refuse(415, "Unsupported content type");
  }

  const session = await deps.getSession();
  if (!session) {
    return refuse(401, "Not signed in");
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return refuse(400, "A valid tenant id is required");
  }

  // Why: this mirrors rag_engine.user_auth.select_tenant on the backend. The request only
  // selects among tenants the token already grants; it is never trusted on its own, and the
  // backend re-checks this same thing independently on every call.
  if (!session.data.user.tenants.includes(parsed.data.tenantId)) {
    return refuse(403, "Tenant not permitted for this user");
  }

  const updated = await deps.setCurrentTenant(session, parsed.data.tenantId);
  if (!updated) {
    return refuse(409, "Session no longer exists");
  }
  return Response.json({ tenantId: parsed.data.tenantId }, { headers: NO_STORE });
}
