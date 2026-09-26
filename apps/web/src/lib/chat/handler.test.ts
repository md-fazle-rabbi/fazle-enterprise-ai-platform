// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";
import { makeSession } from "@/lib/session/fixtures";
import { encodeSse } from "@/lib/sse";
import type { ChatEvent } from "./events";
import { handleChat, type ChatHandlerDeps } from "./handler";

const APP_URL = "http://app.test:3000";
const session: Session = { sid: "sid-1", data: makeSession() };

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

function makeDeps(events: ChatEvent[] = [], signedIn = true) {
  const getSession = vi.fn(async () => (signedIn ? session : null));
  const streamChat = vi.fn(async function* (
    _session: Session,
    _question: string,
    _signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    yield* events;
  });
  const deps: ChatHandlerDeps = { appUrl: APP_URL, getSession, streamChat };
  return { deps, getSession, streamChat };
}

describe("handleChat", () => {
  it.each([
    ["another origin", "http://evil.example"],
    ["no origin", null],
  ])("refuses a request with %s before looking at the session", async (_label, origin) => {
    const { deps, getSession } = makeDeps();
    const response = await handleChat(chatRequest(validBody, { origin }), deps);
    expect(response.status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    const { deps } = makeDeps();
    const response = await handleChat(chatRequest(validBody, { contentType: "text/plain" }), deps);
    expect(response.status).toBe(415);
  });

  it("answers 401 without a session", async () => {
    const { deps, streamChat } = makeDeps([], false);
    const response = await handleChat(chatRequest(validBody), deps);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "signed_out" });
    expect(streamChat).not.toHaveBeenCalled();
  });

  it.each([
    ["broken JSON", "not json"],
    ["a missing question", "{}"],
    ["a blank question", JSON.stringify({ question: "   " })],
    ["a question over 2000 characters", JSON.stringify({ question: "x".repeat(2_001) })],
  ])("answers 400 for %s", async (_label, body) => {
    const { deps, streamChat } = makeDeps();
    const response = await handleChat(chatRequest(body), deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request" });
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("streams the events as Server-Sent Events for the trimmed question", async () => {
    const { deps, streamChat } = makeDeps([STAGE, ERROR]);
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
    const deps: ChatHandlerDeps = { appUrl: APP_URL, getSession: async () => session, streamChat };

    const response = await handleChat(chatRequest(validBody), deps);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("The response has no body");
    }
    await reader.read();
    await reader.cancel();

    await vi.waitFor(() => expect(closed).toBe(true));
  });
});
