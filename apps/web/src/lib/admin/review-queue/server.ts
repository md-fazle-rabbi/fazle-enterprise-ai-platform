import "server-only";
import { env } from "@/env";
import { refreshAccessToken } from "@/lib/auth/oidc";
import { getSession } from "@/lib/auth/session";
import { backendFetch } from "@/lib/backend";
import { getSessionStore } from "@/lib/session";
import type { ReviewQueueHandlerDeps } from "./handler";

// Why: nearly identical to kill-switch/server.ts. Kept as its own file rather than
// extracting a shared getAdminAuthedFetchDeps(), consistent with the rule of three from
// ADR-020: this is the second admin server.ts, not the third.
export async function getReviewQueueHandlerDeps(): Promise<ReviewQueueHandlerDeps> {
  const sessionStore = await getSessionStore();
  return {
    appUrl: env.APP_URL,
    getSession,
    authedFetchDeps: {
      sessionStore,
      refreshTokens: refreshAccessToken,
      backendFetch,
      nowSeconds: () => Math.floor(Date.now() / 1000),
    },
  };
}
