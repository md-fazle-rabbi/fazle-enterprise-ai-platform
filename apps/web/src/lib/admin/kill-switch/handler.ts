import type { NextRequest } from "next/server";
import * as z from "zod";
import { requireAdminRequest, type AdminGuardDeps } from "@/lib/admin/guard";
import { adminFetch, type AuthedFetchDeps } from "@/lib/auth/authed-fetch";
import type { Session } from "@/lib/auth/session";

const NO_STORE = { "Cache-Control": "no-store" };

const statusSchema = z.object({ active: z.boolean() });
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("activate"), reason: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("deactivate") }),
]);

export type KillSwitchHandlerDeps = AdminGuardDeps & {
  authedFetchDeps: AuthedFetchDeps;
};

function refuse(status: number, message: string): Response {
  return Response.json({ message }, { status, headers: NO_STORE });
}

function callBackend(
  deps: KillSwitchHandlerDeps,
  session: Session,
  path: string,
  init?: Parameters<typeof adminFetch>[4],
): Promise<Response> {
  // Why: no tenant argument passed to adminFetch. The kill switch has no tenant of its own
  // (ADR-019), so this never attaches an X-Tenant-ID header.
  return adminFetch(deps.authedFetchDeps, session.sid, session.data, path, init);
}

export async function handleGetKillSwitch(
  request: NextRequest,
  deps: KillSwitchHandlerDeps,
): Promise<Response> {
  const guard = await requireAdminRequest(request, deps);
  if (!guard.ok) {
    return guard.response;
  }
  const response = await callBackend(deps, guard.session, "/admin/kill-switch/status");
  if (!response.ok) {
    await response.body?.cancel();
    return refuse(response.status, "Could not read kill switch status");
  }
  const parsed = statusSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    return refuse(502, "The backend sent an unexpected answer");
  }
  return Response.json(parsed.data, { headers: NO_STORE });
}

export async function handlePostKillSwitch(
  request: NextRequest,
  deps: KillSwitchHandlerDeps,
): Promise<Response> {
  const guard = await requireAdminRequest(request, deps);
  if (!guard.ok) {
    return guard.response;
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return refuse(415, "Unsupported content type");
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return refuse(400, "A valid action is required");
  }

  const response =
    parsed.data.action === "activate"
      ? await callBackend(deps, guard.session, "/admin/kill-switch/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: parsed.data.reason }),
        })
      : await callBackend(deps, guard.session, "/admin/kill-switch/deactivate", {
          method: "POST",
        });

  await response.body?.cancel();
  if (!response.ok) {
    return refuse(response.status, "Could not change the kill switch");
  }
  return Response.json({ active: parsed.data.action === "activate" }, { headers: NO_STORE });
}
