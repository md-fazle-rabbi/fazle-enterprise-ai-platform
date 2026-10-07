import "server-only";
import { env } from "@/env";
import { authedFetch } from "@/lib/auth/authed-fetch";
import { refreshAccessToken } from "@/lib/auth/oidc";
import { getSession } from "@/lib/auth/session";
import { backendFetch } from "@/lib/backend";
import { getSessionStore } from "@/lib/session";
import type { ConversationsHandlerDeps } from "./handler";

export async function getConversationsHandlerDeps(): Promise<ConversationsHandlerDeps> {
  const authedDeps = {
    sessionStore: await getSessionStore(),
    refreshTokens: refreshAccessToken,
    backendFetch,
    nowSeconds: () => Math.floor(Date.now() / 1000),
  };
  return {
    appUrl: env.APP_URL,
    getSession,
    call: (session, path, init) => authedFetch(authedDeps, session.sid, session.data, path, init),
  };
}
