import type { NextRequest } from "next/server";
import * as z from "zod";
import type { Session } from "@/lib/auth/session";
import { chatError, type ChatErrorCode, type ChatEvent } from "@/lib/chat/events";
import type { RateDecision, StreamSlot } from "@/lib/rate-limit/limiter";
import { encodeSse } from "@/lib/sse";

const MAX_QUESTION_LENGTH = 2_000;

const requestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
});

export type ChatLimits = {
  consumeRequest: (userId: string) => Promise<RateDecision>;
  acquireStream: (userId: string) => Promise<StreamSlot | null>;
};

// Why: everything the handler needs comes in through this object, so the rules can be
// tested without Redis, Keycloak or a backend.
export type ChatHandlerDeps = {
  appUrl: string;
  getSession: () => Promise<Session | null>;
  limits: ChatLimits;
  streamChat: (
    session: Session,
    question: string,
    signal: AbortSignal,
  ) => AsyncGenerator<ChatEvent>;
};

const NO_STORE = { "Cache-Control": "no-store" };

function refuse(status: number, code: ChatErrorCode, retryAfterSeconds?: number): Response {
  const headers: Record<string, string> = { ...NO_STORE };
  if (retryAfterSeconds !== undefined) {
    headers["Retry-After"] = String(retryAfterSeconds);
  }
  return Response.json(chatError(code), { status, headers });
}

export async function handleChat(request: NextRequest, deps: ChatHandlerDeps): Promise<Response> {
  // Why: a request from another site must not be able to spend this user's quota. The
  // session cookie is SameSite Lax, and the Origin has to be this app as well.
  if (request.headers.get("origin") !== deps.appUrl) {
    return refuse(403, "invalid_request");
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return refuse(415, "invalid_request");
  }

  const session = await deps.getSession();
  if (!session) {
    return refuse(401, "signed_out");
  }

  // Why: counted BEFORE the body is looked at, so a stream of malformed requests uses up the
  // limit too. Only requests that passed the origin and session checks are counted, so a
  // stranger cannot burn someone else's allowance.
  const userId = session.data.user.id;
  const decision = await deps.limits.consumeRequest(userId);
  if (!decision.allowed) {
    return refuse(429, "rate_limited", decision.retryAfterSeconds);
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return refuse(400, "invalid_request");
  }

  // Why: only a valid question that is really about to start a stream takes a slot.
  const slot = await deps.limits.acquireStream(userId);
  if (!slot) {
    return refuse(429, "too_many_streams");
  }
  // Why: released exactly once, whichever way the stream ends (finished, browser left,
  // failed). If this call itself fails, the slot's own expiry in Redis cleans it up.
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      void slot.release().catch(() => undefined);
    }
  };

  // Why: this controller belongs to the handler. When the browser leaves, the stream's
  // cancel() fires it and the request to the backend is aborted, whether or not the
  // framework also aborts request.signal.
  const abort = new AbortController();
  const events = deps.streamChat(
    session,
    parsed.data.question,
    AbortSignal.any([request.signal, abort.signal]),
  );
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) {
          release();
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(encodeSse(next.value.type, next.value.data)));
      } catch (error) {
        release();
        throw error;
      }
    },
    cancel() {
      release();
      abort.abort();
      void events.return(undefined).catch(() => undefined);
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
