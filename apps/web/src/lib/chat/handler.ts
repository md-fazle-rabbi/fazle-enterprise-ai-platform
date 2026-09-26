import type { NextRequest } from "next/server";
import * as z from "zod";
import type { Session } from "@/lib/auth/session";
import { chatError, type ChatErrorCode, type ChatEvent } from "@/lib/chat/events";
import { encodeSse } from "@/lib/sse";

const MAX_QUESTION_LENGTH = 2_000;

const requestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
});

// Why: everything the handler needs comes in through this object, so the rules can be
// tested without Redis, Keycloak or a backend.
export type ChatHandlerDeps = {
  appUrl: string;
  getSession: () => Promise<Session | null>;
  streamChat: (
    session: Session,
    question: string,
    signal: AbortSignal,
  ) => AsyncGenerator<ChatEvent>;
};

const NO_STORE = { "Cache-Control": "no-store" };

function refuse(status: number, code: ChatErrorCode): Response {
  return Response.json(chatError(code), { status, headers: NO_STORE });
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

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return refuse(400, "invalid_request");
  }

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
      const next = await events.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(encodeSse(next.value.type, next.value.data)));
    },
    cancel() {
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
