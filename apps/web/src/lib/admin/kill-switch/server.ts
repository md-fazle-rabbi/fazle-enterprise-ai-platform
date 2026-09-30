import "server-only";
import { env } from "@/env";
import { refreshAccessToken } from "@/lib/auth/oidc";
import { getSession } from "@/lib/auth/session";
import { backendFetch } from "@/lib/backend";
import { getSessionStore } from "@/lib/session";
import type { KillSwitchHandlerDeps } from "./handler";

export async function getKillSwitchHandlerDeps(): Promise<KillSwitchHandlerDeps> {
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
