import type { NextRequest } from "next/server";
import * as z from "zod";
import { requireAdminRequest, type AdminGuardDeps } from "@/lib/admin/guard";
import { adminFetch, type AuthedFetchDeps } from "@/lib/auth/authed-fetch";

const NO_STORE = { "Cache-Control": "no-store" };

const reviewItemSchema = z.object({
  id: z.guid(),
  question: z.string(),
  answer: z.string(),
  flag_reasons: z.array(z.string()),
  status: z.string(),
});
const reviewListSchema = z.array(reviewItemSchema);
const noteSchema = z.object({ note: z.string().trim().max(2_000).optional() });

export type ReviewQueueHandlerDeps = AdminGuardDeps & {
  authedFetchDeps: AuthedFetchDeps;
};

function refuse(status: number, message: string): Response {
  return Response.json({ message }, { status, headers: NO_STORE });
}

export async function handleGetReviewQueue(
  request: NextRequest,
  deps: ReviewQueueHandlerDeps,
): Promise<Response> {
  const guard = await requireAdminRequest(request, deps);
  if (!guard.ok) {
    return guard.response;
  }

  // Why: checked before calling the backend at all. The review queue is tenant-scoped
  // (unlike the kill switch), and with no tenant selected there is nothing to ask for.
  const tenantId = guard.session.data.currentTenantId;
  if (tenantId === null) {
    return Response.json({ tenantSelected: false, items: [] }, { headers: NO_STORE });
  }

  const response = await adminFetch(
    deps.authedFetchDeps,
    guard.session.sid,
    guard.session.data,
    "/review-queue",
    undefined,
    tenantId,
  );
  if (!response.ok) {
    await response.body?.cancel();
    return refuse(response.status, "Could not load the review queue");
  }
  const parsed = reviewListSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    return refuse(502, "The backend sent an unexpected answer");
  }
  return Response.json({ tenantSelected: true, items: parsed.data }, { headers: NO_STORE });
}

export async function handleResolveReviewItem(
  request: NextRequest,
  deps: ReviewQueueHandlerDeps,
  itemId: string,
): Promise<Response> {
  const guard = await requireAdminRequest(request, deps);
  if (!guard.ok) {
    return guard.response;
  }
  if (!z.guid().safeParse(itemId).success) {
    return refuse(400, "Invalid item id");
  }
  const tenantId = guard.session.data.currentTenantId;
  if (tenantId === null) {
    return refuse(409, "No workspace selected");
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return refuse(415, "Unsupported content type");
  }
  const parsed = noteSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return refuse(400, "Invalid request");
  }

  const response = await adminFetch(
    deps.authedFetchDeps,
    guard.session.sid,
    guard.session.data,
    `/review-queue/${itemId}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: parsed.data.note ?? null }),
    },
    tenantId,
  );
  if (response.status === 404) {
    await response.body?.cancel();
    return refuse(404, "Not found");
  }
  if (!response.ok) {
    await response.body?.cancel();
    return refuse(response.status, "Could not resolve this item");
  }
  const parsedItem = reviewItemSchema.safeParse(await response.json().catch(() => null));
  if (!parsedItem.success) {
    return refuse(502, "The backend sent an unexpected answer");
  }
  return Response.json(parsedItem.data, { headers: NO_STORE });
}
