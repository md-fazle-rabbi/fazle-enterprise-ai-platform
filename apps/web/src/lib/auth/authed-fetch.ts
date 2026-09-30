import "server-only";
import { applyRefresh, type RefreshedTokens } from "@/lib/auth/claims";
import { NoTenantError, NotSignedInError, RefreshRejectedError } from "@/lib/auth/errors";
import type { BackendInit } from "@/lib/backend";
import type { SessionData } from "@/lib/session/data";
import type { RedisSessionStore } from "@/lib/session/store";

const REFRESH_MARGIN_SECONDS = 30;

export type AuthedFetchDeps = {
  sessionStore: Pick<RedisSessionStore, "update" | "destroy">;
  refreshTokens: (refreshToken: string) => Promise<RefreshedTokens>;
  backendFetch: (path: string, init?: BackendInit) => Promise<Response>;
  nowSeconds: () => number;
};

async function refresh(
  deps: AuthedFetchDeps,
  sid: string,
  session: SessionData,
): Promise<SessionData> {
  let refreshed: RefreshedTokens;
  try {
    refreshed = await deps.refreshTokens(session.refreshToken);
  } catch (error) {
    if (error instanceof RefreshRejectedError) {
      await deps.sessionStore.destroy(sid);
      throw new NotSignedInError("The session can no longer be refreshed", { cause: error });
    }
    throw error;
  }

  const next = applyRefresh(session, refreshed);
  if (!(await deps.sessionStore.update(sid, next))) {
    throw new NotSignedInError("The session no longer exists");
  }
  return next;
}

function send(
  deps: AuthedFetchDeps,
  session: SessionData,
  tenantId: string | null,
  path: string,
  init: BackendInit,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.accessToken}`);
  if (tenantId !== null) {
    headers.set("X-Tenant-ID", tenantId);
  }
  return deps.backendFetch(path, { ...init, headers });
}

// Why: the piece authedFetch and adminFetch share -- refresh a token that is about to
// expire, send, and retry once on a 401. Neither this function nor send() knows or cares
// whether a tenant header was attached; that decision belongs to each caller.
async function fetchWithRefresh(
  deps: AuthedFetchDeps,
  sid: string,
  session: SessionData,
  tenantId: string | null,
  path: string,
  init: BackendInit,
): Promise<Response> {
  let current = session;
  if (current.accessTokenExpiresAt - deps.nowSeconds() <= REFRESH_MARGIN_SECONDS) {
    current = await refresh(deps, sid, current);
  }

  let response = await send(deps, current, tenantId, path, init);
  if (response.status === 401) {
    await response.body?.cancel();
    current = await refresh(deps, sid, current);
    response = await send(deps, current, tenantId, path, init);
  }
  return response;
}

export async function authedFetch(
  deps: AuthedFetchDeps,
  sid: string,
  session: SessionData,
  path: string,
  init: BackendInit = {},
): Promise<Response> {
  const tenantId = session.currentTenantId;
  if (tenantId === null || !session.user.tenants.includes(tenantId)) {
    throw new NoTenantError("No tenant currently selected for this user");
  }
  return fetchWithRefresh(deps, sid, session, tenantId, path, init);
}

// Why: admin routes need the same refresh-and-retry behaviour, but not every one of them
// has a tenant of its own -- the kill switch is platform-wide. A tenant is attached only
// when the caller passes one, and it is still checked against the user's own tenants, the
// same defense authedFetch applies, so a stale or forged tenant id can never be sent even
// for an admin route that happens to accept one.
export async function adminFetch(
  deps: AuthedFetchDeps,
  sid: string,
  session: SessionData,
  path: string,
  init: BackendInit = {},
  tenantId: string | null = null,
): Promise<Response> {
  if (tenantId !== null && !session.user.tenants.includes(tenantId)) {
    throw new NoTenantError("Tenant not permitted for this user");
  }
  return fetchWithRefresh(deps, sid, session, tenantId, path, init);
}
