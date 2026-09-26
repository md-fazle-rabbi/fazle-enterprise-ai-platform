// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NoTenantError, NotSignedInError } from "@/lib/auth/errors";
import { encodeSse } from "@/lib/sse";
import { CHAT_ERROR_MESSAGES, type ChatErrorCode, type ChatEvent } from "./events";
import { streamChat, type ChatStreamDeps } from "./stream";

const CITATION = {
  chunk_id: "11111111-1111-4111-8111-111111111111",
  document_id: "22222222-2222-4222-8222-222222222222",
  heading_path: ["Refunds"],
  text: "Customers can request a full refund within 30 days.",
};
const RESULT = {
  answer: "Within 30 days [1]",
  citations: [CITATION],
  retrieved_context: [CITATION],
  retrieved_but_uncited_count: 0,
  flagged: false,
  flag_reasons: [],
};

const stage = (name: string) => encodeSse("stage", { stage: name });
const result = (payload: unknown = RESULT) => encodeSse("result", payload);
const failure = (code: ChatErrorCode): ChatEvent => ({
  type: "error",
  data: { code, message: CHAT_ERROR_MESSAGES[code] },
});

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function streaming(chunks: string[]): ChatStreamDeps {
  return { openUpstream: async () => sseResponse(chunks) };
}

async function collect(events: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const collected: ChatEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

const noSignal = () => new AbortController().signal;

describe("streamChat", () => {
  it("passes stages and the result through and stops at the result", async () => {
    const chunks = [
      stage("cache_lookup"),
      ": ping\n\n",
      stage("retrieval"),
      result(),
      stage("generation"),
    ];
    expect(await collect(streamChat(streaming(chunks), "q", noSignal()))).toEqual([
      { type: "stage", data: { stage: "cache_lookup" } },
      { type: "stage", data: { stage: "retrieval" } },
      { type: "result", data: RESULT },
    ]);
  });

  it("copes with chunk boundaries inside events", async () => {
    const pieces = (stage("retrieval") + result()).match(/[\s\S]{1,7}/g) ?? [];
    const events = await collect(streamChat(streaming(pieces), "q", noSignal()));
    expect(events.map((event) => event.type)).toEqual(["stage", "result"]);
  });

  it.each([
    [429, "quota"],
    [500, "internal"],
  ] as const)("maps an upstream error event with status %i to %s", async (status, code) => {
    const chunks = [encodeSse("error", { status, detail: "secret backend detail" })];
    const events = await collect(streamChat(streaming(chunks), "q", noSignal()));
    expect(events).toEqual([failure(code)]);
    expect(JSON.stringify(events)).not.toContain("secret backend detail");
  });

  it.each([
    [400, { detail: "Request blocked: possible prompt injection detected." }, "blocked"],
    [400, { detail: "X-Tenant-ID must be a UUID" }, "invalid_request"],
    [401, { detail: "Invalid or expired token" }, "signed_out"],
    [429, { detail: "quota" }, "quota"],
    [500, { detail: "boom" }, "unavailable"],
  ] as const)("maps upstream status %i (case %#) to %s", async (status, payload, code) => {
    const deps: ChatStreamDeps = {
      openUpstream: async () => new Response(JSON.stringify(payload), { status }),
    };
    expect(await collect(streamChat(deps, "q", noSignal()))).toEqual([failure(code)]);
  });

  it.each([
    [new NotSignedInError("over"), "signed_out"],
    [new NoTenantError("none"), "no_tenant"],
    [new TypeError("fetch failed"), "unavailable"],
  ] as const)("maps the thrown %s to %s", async (error, code) => {
    const deps: ChatStreamDeps = {
      openUpstream: async () => {
        throw error;
      },
    };
    expect(await collect(streamChat(deps, "q", noSignal()))).toEqual([failure(code)]);
  });

  it("treats a result of the wrong shape as an internal error", async () => {
    const events = await collect(
      streamChat(streaming([result({ answer: "no other fields" })]), "q", noSignal()),
    );
    expect(events).toEqual([failure("internal")]);
  });

  it("ignores unknown events and unknown stages", async () => {
    const chunks = [encodeSse("mystery", {}), stage("teleport"), result()];
    expect(await collect(streamChat(streaming(chunks), "q", noSignal()))).toEqual([
      { type: "result", data: RESULT },
    ]);
  });

  it("reports a stream that ends without a result", async () => {
    const events = await collect(streamChat(streaming([stage("retrieval")]), "q", noSignal()));
    expect(events).toEqual([
      { type: "stage", data: { stage: "retrieval" } },
      failure("unavailable"),
    ]);
  });

  it("cancels the upstream request when the consumer stops early", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const deps: ChatStreamDeps = {
      openUpstream: async (_question, signal) => {
        upstreamSignal = signal;
        return sseResponse([stage("retrieval"), result()]);
      },
    };
    const events = streamChat(deps, "q", noSignal());

    await events.next();
    expect(upstreamSignal?.aborted).toBe(false);
    await events.return(undefined);

    expect(upstreamSignal?.aborted).toBe(true);
  });
});
