import "server-only";
import * as z from "zod";
import { NoTenantError, NotSignedInError } from "@/lib/auth/errors";
import {
  chatError,
  chatResultSchema,
  stageSchema,
  type ChatErrorCode,
  type ChatEvent,
} from "@/lib/chat/events";
import { createSseParser, type SseMessage } from "@/lib/sse";

export type ChatStreamDeps = {
  openUpstream: (question: string, signal: AbortSignal) => Promise<Response>;
};

const upstreamStageSchema = z.object({ stage: stageSchema });
const upstreamErrorSchema = z.object({ status: z.number().int() });

const fail = (code: ChatErrorCode): ChatEvent => ({ type: "error", data: chatError(code) });

function codeForFailure(error: unknown): ChatErrorCode {
  if (error instanceof NotSignedInError) {
    return "signed_out";
  }
  if (error instanceof NoTenantError) {
    return "no_tenant";
  }
  return "unavailable";
}

// Why: only the status is used, plus, for a 400, whether it was the injection firewall.
// Nothing the backend wrote is shown to the user.
async function codeForStatus(response: Response): Promise<ChatErrorCode> {
  const { status } = response;
  if (status === 400) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      typeof body === "object" && body !== null && "detail" in body ? body.detail : undefined;
    return typeof detail === "string" && detail.startsWith("Request blocked")
      ? "blocked"
      : "invalid_request";
  }
  await response.body?.cancel();
  if (status === 401) {
    return "signed_out";
  }
  if (status === 403) {
    return "no_tenant";
  }
  if (status === 429) {
    return "quota";
  }
  if (status === 422) {
    return "invalid_request";
  }
  return "unavailable";
}

// Why: unknown events and unknown stage names are dropped, so a newer backend that adds a
// stage does not break an older web app. A result or error of the wrong shape is a failure.
function translate(message: SseMessage): ChatEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(message.data);
  } catch {
    return fail("internal");
  }
  switch (message.event) {
    case "stage": {
      const parsed = upstreamStageSchema.safeParse(payload);
      return parsed.success ? { type: "stage", data: parsed.data } : null;
    }
    case "result": {
      const parsed = chatResultSchema.safeParse(payload);
      return parsed.success ? { type: "result", data: parsed.data } : fail("internal");
    }
    case "error": {
      const parsed = upstreamErrorSchema.safeParse(payload);
      return fail(parsed.success && parsed.data.status === 429 ? "quota" : "internal");
    }
    default:
      return null;
  }
}

async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      for (const message of parser.feed(decoder.decode(value, { stream: true }))) {
        const event = translate(message);
        if (event === null) {
          continue;
        }
        yield event;
        // A result or an error is the last thing the backend sends.
        if (event.type !== "stage") {
          return;
        }
      }
    }
    yield fail("unavailable");
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function* streamChat(
  deps: ChatStreamDeps,
  question: string,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  // Why: our own controller, so closing this generator early (the browser went away) also
  // cancels the request to the backend, which then stops its own work.
  const upstream = new AbortController();
  try {
    const response = await deps.openUpstream(question, AbortSignal.any([upstream.signal, signal]));
    if (!response.ok) {
      yield fail(await codeForStatus(response));
      return;
    }
    if (!response.body) {
      yield fail("unavailable");
      return;
    }
    yield* readEvents(response.body);
  } catch (error) {
    yield fail(codeForFailure(error));
  } finally {
    upstream.abort();
  }
}
