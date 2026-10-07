// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";
import type { RateDecision, StreamSlot } from "@/lib/rate-limit/limiter";
import { makeSession } from "@/lib/session/fixtures";
import { encodeSse } from "@/lib/sse";
import type { ChatEvent, ChatResult } from "./events";
import { handleChat, type ChatHandlerDeps, type ChatLimits } from "./handler";
import type { SaveExchangeInput } from "./history-save";

const APP_URL = "http://app.test:3000";
const session: Session = { sid: "sid-1", data: makeSession() };

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const SAVED_ID = "33333333-3333-4333-8333-333333333333";
const RESULT: ChatResult = {
  answer: "Within 30 days [1]",
  citations: [],
  retrieved_context: [],
  retrieved_but_uncited_count: 0,
  flagged: false,
  flag_reasons: [],
};
const RESULT_EVENT: ChatEvent = { type: "result", data: RESULT };

const STAGE: ChatEvent = { type: "stage", data: { stage: "retrieval" } };
const ERROR: ChatEvent = {
  type: "error",
  data: { code: "unavailable", message: "The answer service is not available right now." },
};

function chatRequest(
  body: string,
  options: { origin?: string | null; contentType?: string } = {},
): NextRequest {
  const { origin = APP_URL, contentType = "application/json" } = options;
  const headers = new Headers({ "content-type": contentType });
  if (origin !== null) {
    headers.set("origin", origin);
  }
  return new NextRequest(`${APP_URL}/api/chat`, { method: "POST", headers, body });
}

const validBody = JSON.stringify({ question: "  How long is the refund window?  " });

function makeLimits(options: { decision?: RateDecision; slot?: StreamSlot | null } = {}) {
  const release = vi.fn(async () => undefined);
  const consumeRequest = vi.fn(
    async (_userId: string): Promise<RateDecision> =>
      options.decision ?? { allowed: true, remaining: 19 },
  );
  const acquireStream = vi.fn(async (_userId: string): Promise<StreamSlot | null> =>
    options.slot === undefined ? { release } : options.slot,
  );
  const limits: ChatLimits = { consumeRequest, acquireStream };
  return { limits, release, consumeRequest, acquireStream };
}

type SaveFn = (session: Session, input: SaveExchangeInput) => Promise<string | null>;

function makeDeps(
  events: ChatEvent[] = [],
  signedIn = true,
  limitOptions: Parameters<typeof makeLimits>[0] = {},
  save: SaveFn = async () => SAVED_ID,
) {
  const getSession = vi.fn(async () => (signedIn ? session : null));
  const streamChat = vi.fn(async function* (
    _session: Session,
    _question: string,
    _signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    yield* events;
  });
  const saveExchange = vi.fn(save);
  const limited = makeLimits(limitOptions);
  const deps: ChatHandlerDeps = {
    appUrl: APP_URL,
    getSession,
    streamChat,
    saveExchange,
    limits: limited.limits,
  };
  return { deps, getSession, streamChat, saveExchange, ...limited };
}

describe("handleChat", () => {
  it.each([
    ["another origin", "http://evil.example"],
    ["no origin", null],
  ])("refuses a request with %s before looking at the session", async (_label, origin) => {
    const { deps, getSession, consumeRequest } = makeDeps();
    const response = await handleChat(chatRequest(validBody, { origin }), deps);
    expect(response.status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
    expect(consumeRequest).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    const { deps } = makeDeps();
    const response = await handleChat(chatRequest(validBody, { contentType: "text/plain" }), deps);
    expect(response.status).toBe(415);
  });

  it("answers 401 without a session, and without touching the limiter", async () => {
    const { deps, streamChat, consumeRequest } = makeDeps([], false);
    const response = await handleChat(chatRequest(validBody), deps);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "signed_out" });
    expect(streamChat).not.toHaveBeenCalled();
    expect(consumeRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["broken JSON", "not json"],
    ["a missing question", "{}"],
    ["a blank question", JSON.stringify({ question: "   " })],
    ["a question over 2000 characters", JSON.stringify({ question: "x".repeat(2_001) })],
  ])("answers 400 for %s", async (_label, body) => {
    const { deps, streamChat, acquireStream } = makeDeps();
    const response = await handleChat(chatRequest(body), deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request" });
    expect(streamChat).not.toHaveBeenCalled();
    expect(acquireStream).not.toHaveBeenCalled();
  });

  it("streams the events as Server-Sent Events for the trimmed question", async () => {
    const { deps, streamChat, consumeRequest, acquireStream } = makeDeps([STAGE, ERROR]);
    const response = await handleChat(chatRequest(validBody), deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(await response.text()).toBe(
      encodeSse("stage", STAGE.data) + encodeSse("error", ERROR.data),
    );
    expect(streamChat).toHaveBeenCalledWith(
      session,
      "How long is the refund window?",
      expect.any(AbortSignal),
    );
    expect(consumeRequest).toHaveBeenCalledWith(session.data.user.id);
    expect(acquireStream).toHaveBeenCalledWith(session.data.user.id);
  });

  it("stops the work when the browser cancels the stream", async () => {
    let closed = false;
    const streamChat = vi.fn(async function* (
      _session: Session,
      _question: string,
      signal: AbortSignal,
    ): AsyncGenerator<ChatEvent> {
      try {
        yield STAGE;
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      } finally {
        closed = true;
      }
    });
    const { limits } = makeLimits();
    const deps: ChatHandlerDeps = {
      appUrl: APP_URL,
      getSession: async () => session,
      streamChat,
      saveExchange: async () => SAVED_ID,
      limits,
    };

    const response = await handleChat(chatRequest(validBody), deps);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("The response has no body");
    }
    await reader.read();
    await reader.cancel();

    await vi.waitFor(() => expect(closed).toBe(true));
  });

  it("answers 429 with a Retry-After header when the rate limit is used up", async () => {
    const { deps, streamChat, acquireStream } = makeDeps([], true, {
      decision: { allowed: false, retryAfterSeconds: 7 },
    });
    const response = await handleChat(chatRequest(validBody), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(await response.json()).toMatchObject({ code: "rate_limited" });
    expect(streamChat).not.toHaveBeenCalled();
    expect(acquireStream).not.toHaveBeenCalled();
  });

  it("counts a malformed request against the rate limit", async () => {
    const { deps, consumeRequest } = makeDeps();
    const response = await handleChat(chatRequest("not json"), deps);
    expect(response.status).toBe(400);
    expect(consumeRequest).toHaveBeenCalledTimes(1);
  });

  it("answers 429 when the user already has too many answers in progress", async () => {
    const { deps, streamChat } = makeDeps([], true, { slot: null });
    const response = await handleChat(chatRequest(validBody), deps);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "too_many_streams" });
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("releases the stream slot once, when the stream finishes", async () => {
    const { deps, release } = makeDeps([STAGE]);
    const response = await handleChat(chatRequest(validBody), deps);
    await response.text();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases the stream slot once, when the browser cancels", async () => {
    const { deps, release } = makeDeps([STAGE, STAGE]);
    const response = await handleChat(chatRequest(validBody), deps);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("The response has no body");
    }
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });

  it("releases the stream slot when the answer generator fails", async () => {
    const release = vi.fn(async () => undefined);
    const streamChat = vi.fn(async function* (): AsyncGenerator<ChatEvent> {
      yield STAGE;
      throw new Error("generator failed");
    });
    const { limits } = makeLimits({ slot: { release } });
    const deps: ChatHandlerDeps = {
      appUrl: APP_URL,
      getSession: async () => session,
      streamChat,
      saveExchange: async () => SAVED_ID,
      limits,
    };

    const response = await handleChat(chatRequest(validBody), deps);
    await expect(response.text()).rejects.toThrow("generator failed");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("saves the exchange after the result and tells the browser where it went", async () => {
    const { deps, saveExchange } = makeDeps([STAGE, RESULT_EVENT]);
    const response = await handleChat(
      chatRequest(JSON.stringify({ question: "  Refunds?  ", conversationId: CONVERSATION_ID })),
      deps,
    );
    expect(await response.text()).toBe(
      encodeSse("stage", STAGE.data) +
        encodeSse("result", RESULT) +
        encodeSse("history", { conversationId: SAVED_ID }),
    );
    expect(saveExchange).toHaveBeenCalledWith(session, {
      conversationId: CONVERSATION_ID,
      question: "Refunds?",
      result: RESULT,
    });
  });

  it("starts a new conversation when none is given", async () => {
    const { deps, saveExchange } = makeDeps([RESULT_EVENT]);
    await (await handleChat(chatRequest(validBody), deps)).text();
    expect(saveExchange.mock.calls[0]?.[1].conversationId).toBeNull();
  });

  it("still delivers the answer when the save reports failure", async () => {
    const { deps } = makeDeps([RESULT_EVENT], true, {}, async () => null);
    const text = await (await handleChat(chatRequest(validBody), deps)).text();
    expect(text).toBe(encodeSse("result", RESULT) + encodeSse("history", { conversationId: null }));
  });

  it("still delivers the answer when the save throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps } = makeDeps([RESULT_EVENT], true, {}, async () => {
      throw new Error("backend down");
    });
    const text = await (await handleChat(chatRequest(validBody), deps)).text();
    expect(text).toContain(encodeSse("result", RESULT));
    expect(text).toContain(encodeSse("history", { conversationId: null }));
  });

  it("does not save when the answer ended in an error", async () => {
    const { deps, saveExchange } = makeDeps([ERROR]);
    await (await handleChat(chatRequest(validBody), deps)).text();
    expect(saveExchange).not.toHaveBeenCalled();
  });

  it("refuses a conversation id that is not a UUID", async () => {
    const { deps, streamChat } = makeDeps();
    const response = await handleChat(
      chatRequest(JSON.stringify({ question: "hi", conversationId: "nope" })),
      deps,
    );
    expect(response.status).toBe(400);
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("does not fail when the browser leaves while the exchange is being saved", async () => {
    let finishSave: (id: string | null) => void = () => undefined;
    const slowSave: SaveFn = () =>
      new Promise<string | null>((resolve) => {
        finishSave = resolve;
      });
    const { deps, saveExchange } = makeDeps([RESULT_EVENT], true, {}, slowSave);

    const response = await handleChat(chatRequest(validBody), deps);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("The response has no body");
    }
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(saveExchange).toHaveBeenCalled());
    finishSave(SAVED_ID);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
