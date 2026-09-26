import "server-only";
import { env } from "@/env";
import { authedFetch } from "@/lib/auth/authed-fetch";
import { refreshAccessToken } from "@/lib/auth/oidc";
import { getSession, type Session } from "@/lib/auth/session";
import { backendFetch } from "@/lib/backend";
import { chatError, type ChatEvent } from "@/lib/chat/events";
import type { ChatHandlerDeps } from "@/lib/chat/handler";
import { streamChat } from "@/lib/chat/stream";
import { getSessionStore } from "@/lib/session";

// Why: one streamed answer can include several model calls. The backend sends a keepalive
// every 15 seconds, so a silent hang is caught by this overall limit.
const CHAT_TIMEOUT_MS = 120_000;

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

export function getChatHandlerDeps(): ChatHandlerDeps {
  return { appUrl: env.APP_URL, getSession, streamChat: chatForSession };
}
