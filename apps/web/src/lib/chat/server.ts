import "server-only";
import { env } from "@/env";
import { authedFetch } from "@/lib/auth/authed-fetch";
import { refreshAccessToken } from "@/lib/auth/oidc";
import { getSession, type Session } from "@/lib/auth/session";
import { backendFetch } from "@/lib/backend";
import { chatError, type ChatEvent } from "@/lib/chat/events";
import type { ChatHandlerDeps, ChatLimits } from "@/lib/chat/handler";
import { streamChat } from "@/lib/chat/stream";
import { createConcurrencyLimiter, createSlidingWindowLimiter } from "@/lib/rate-limit/limiter";
import { createRateLimitRedis, getRedis } from "@/lib/redis";
import { getSessionStore } from "@/lib/session";

// Why: one streamed answer can include several model calls. The backend sends a keepalive
// every 15 seconds, so a silent hang is caught by this overall limit.
const CHAT_TIMEOUT_MS = 120_000;
// Why: a slot outlives the longest possible stream by 30 seconds, so a healthy stream never
// loses its slot early, and a crashed one frees it soon after.
const SLOT_TTL_MS = CHAT_TIMEOUT_MS + 30_000;

async function* chatForSession(
  session: Session,
  question: string,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  let sessionStore;
  try {
    sessionStore = await getSessionStore();
  } catch {
    yield { type: "error", data: chatError("unavailable") };
    return;
  }

  const openUpstream = (text: string, upstreamSignal: AbortSignal) =>
    authedFetch(
      {
        sessionStore,
        refreshTokens: refreshAccessToken,
        backendFetch,
        nowSeconds: () => Math.floor(Date.now() / 1000),
      },
      session.sid,
      session.data,
      "/query/stream",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ question: text }),
        signal: upstreamSignal,
        timeoutMs: CHAT_TIMEOUT_MS,
      },
    );

  yield* streamChat({ openUpstream }, question, signal);
}

async function buildLimits(): Promise<ChatLimits> {
  const redis = createRateLimitRedis(await getRedis());
  const requests = createSlidingWindowLimiter({
    redis,
    keyPrefix: "web:rl:chat:",
    limit: env.CHAT_RATE_LIMIT_MAX,
    windowMs: env.CHAT_RATE_LIMIT_WINDOW_SECONDS * 1_000,
  });
  const streams = createConcurrencyLimiter({
    redis,
    keyPrefix: "web:conc:chat:",
    max: env.CHAT_MAX_CONCURRENT_STREAMS,
    holderTtlMs: SLOT_TTL_MS,
  });
  return {
    consumeRequest: (userId) => requests.consume(userId),
    acquireStream: (userId) => streams.acquire(userId),
  };
}

export async function getChatHandlerDeps(): Promise<ChatHandlerDeps> {
  return {
    appUrl: env.APP_URL,
    getSession,
    limits: await buildLimits(),
    streamChat: chatForSession,
  };
}
