import "server-only";
import { applyRefresh, type RefreshedTokens } from "@/lib/auth/claims";
import { NoTenantError, NotSignedInError, RefreshRejectedError } from "@/lib/auth/errors";
import type { BackendInit } from "@/lib/backend";
import type { SessionData } from "@/lib/session/data";
import type { RedisSessionStore } from "@/lib/session/store";

// Why: new tokens are fetched a little early, so a token is never sent that runs out on
// the way.
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
    // Why: anything else (Keycloak down, a network error) may pass. The session stays, so a
    // short outage does not sign everybody out.
    throw error;
  }

  const next = applyRefresh(session, refreshed);
  // Why: update refuses when the session is gone (logged out, expired), so a refresh that
  // finishes late cannot bring a dead session back.
  if (!(await deps.sessionStore.update(sid, next))) {
    throw new NotSignedInError("The session no longer exists");
  }
  return next;
}

function send(
  deps: AuthedFetchDeps,
  session: SessionData,
  tenantId: string,
  path: string,
  init: BackendInit,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.accessToken}`);
  headers.set("X-Tenant-ID", tenantId);
  return deps.backendFetch(path, { ...init, headers });
}

export async function authedFetch(
  deps: AuthedFetchDeps,
  sid: string,
  session: SessionData,
  path: string,
  init: BackendInit = {},
): Promise<Response> {
  // Why: until the tenant selector exists, the first tenant of the user is used. The backend
  // still checks that the token grants it, so this can only ever narrow access.
  const tenantId = session.user.tenants[0];
  if (tenantId === undefined) {
    throw new NoTenantError("The signed in user has no tenant");
  }

  let current = session;
  if (current.accessTokenExpiresAt - deps.nowSeconds() <= REFRESH_MARGIN_SECONDS) {
    current = await refresh(deps, sid, current);
  }

  let response = await send(deps, current, tenantId, path, init);
  if (response.status === 401) {
    // Why: one retry with fresh tokens, no more. A backend that keeps refusing is reported
    // as it is, not retried in a loop.
    await response.body?.cancel();
    current = await refresh(deps, sid, current);
    response = await send(deps, current, tenantId, path, init);
  }
  return response;
}
