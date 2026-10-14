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

// Why: built when a limit is first needed, not when the handler is wired up. The Origin and
// content type checks come first in handler.ts and need no Redis, so a request from another
// site gets its 403 even while Redis is down. Nothing is cached between calls: these are
// thin objects, and the state lives in Redis.
async function limiters() {
  const redis = createRateLimitRedis(await getRedis());
  return {
    // Why: its own key prefixes, so uploads never share the chat budget in either direction.
    requests: createSlidingWindowLimiter({
      redis,
      keyPrefix: "web:rl:upload:",
      limit: env.UPLOAD_RATE_LIMIT_MAX,
      windowMs: env.UPLOAD_RATE_LIMIT_WINDOW_SECONDS * 1_000,
    }),
    uploads: createConcurrencyLimiter({
      redis,
      keyPrefix: "web:conc:upload:",
      max: env.UPLOAD_MAX_CONCURRENT,
      holderTtlMs: SLOT_TTL_MS,
    }),
  };
}

export function getUploadHandlerDeps(): UploadHandlerDeps {
  return {
    appUrl: env.APP_URL,
    getSession,
    limits: {
      consumeRequest: async (userId) => (await limiters()).requests.consume(userId),
      acquireUpload: async (userId) => (await limiters()).uploads.acquire(userId),
    },
    // Why: the session is read again right before the call. Reading a large upload takes
    // time, and another request may have refreshed the tokens meanwhile. A stale copy would
    // refresh again with an old refresh token, which destroys the session if Keycloak rotates
    // refresh tokens.
    forward: async (session, path, init) => {
      const sessionStore = await getSessionStore();
      const current = await sessionStore.get(session.sid);
      if (!current) {
        throw new NotSignedInError("The session no longer exists");
      }
      return authedFetch(
        {
          sessionStore,
          refreshTokens: refreshAccessToken,
          backendFetch,
          nowSeconds: () => Math.floor(Date.now() / 1000),
        },
        session.sid,
        current,
        path,
        init,
      );
    },
  };
}
