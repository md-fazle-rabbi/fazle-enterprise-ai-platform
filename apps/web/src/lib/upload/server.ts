import "server-only";
import { env } from "@/env";
import { authedFetch } from "@/lib/auth/authed-fetch";
import { NotSignedInError } from "@/lib/auth/errors";
import { refreshAccessToken } from "@/lib/auth/oidc";
import { getSession } from "@/lib/auth/session";
import { backendFetch } from "@/lib/backend";
import { createConcurrencyLimiter, createSlidingWindowLimiter } from "@/lib/rate-limit/limiter";
import { createRateLimitRedis, getRedis } from "@/lib/redis";
import { getSessionStore } from "@/lib/session";
import { LONGEST_BACKEND_TIMEOUT_MS } from "./forward";
import type { UploadHandlerDeps } from "./handler";

// Why: a slot outlives the longest backend call by 30 seconds, so a healthy upload never
// loses its slot early, and a crashed one frees it soon after.
const SLOT_TTL_MS = LONGEST_BACKEND_TIMEOUT_MS + 30_000;

export async function getUploadHandlerDeps(): Promise<UploadHandlerDeps> {
  const redis = createRateLimitRedis(await getRedis());
  // Why: its own key prefixes, so uploads never share the chat budget in either direction.
  const requests = createSlidingWindowLimiter({
    redis,
    keyPrefix: "web:rl:upload:",
    limit: env.UPLOAD_RATE_LIMIT_MAX,
    windowMs: env.UPLOAD_RATE_LIMIT_WINDOW_SECONDS * 1_000,
  });
  const uploads = createConcurrencyLimiter({
    redis,
    keyPrefix: "web:conc:upload:",
    max: env.UPLOAD_MAX_CONCURRENT,
    holderTtlMs: SLOT_TTL_MS,
  });

  const sessionStore = await getSessionStore();
  const authedDeps = {
    sessionStore,
    refreshTokens: refreshAccessToken,
    backendFetch,
    nowSeconds: () => Math.floor(Date.now() / 1000),
  };

  return {
    appUrl: env.APP_URL,
    getSession,
    limits: {
      consumeRequest: (userId) => requests.consume(userId),
      acquireUpload: (userId) => uploads.acquire(userId),
    },
    // Why: the session is read again right before the call. Reading a large upload takes
    // time, and another request may have refreshed the tokens meanwhile. A stale copy would
    // refresh again with an old refresh token, which destroys the session if Keycloak rotates
    // refresh tokens.
    forward: async (session, path, init) => {
      const current = await sessionStore.get(session.sid);
      if (!current) {
        throw new NotSignedInError("The session no longer exists");
      }
      return authedFetch(authedDeps, session.sid, current, path, init);
    },
  };
}
