// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { NoTenantError } from "@/lib/auth/errors";
import type { Session } from "@/lib/auth/session";
import { makeSession } from "@/lib/session/fixtures";
import {
  handleDeleteConversation,
  handleGetConversation,
  handleListConversations,
  type ConversationsHandlerDeps,
} from "./handler";

const APP_URL = "http://app.test:3000";
const ID = "11111111-1111-4111-8111-111111111111";
const session: Session = { sid: "sid-1", data: makeSession() };

type CallFn = ConversationsHandlerDeps["call"];

const listed = [
  {
    id: ID,
    title: "Refunds?",
    created_at: "2026-10-03T09:00:00Z",
    updated_at: "2026-10-03T09:05:00Z",
  },
];
const validResult = {
  answer: "Within 30 days",
  citations: [],
  retrieved_context: [],
  retrieved_but_uncited_count: 0,
  flagged: false,
  flag_reasons: [],
};

function detail(assistantResult: unknown) {
  return {
    ...listed[0],
    messages: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        role: "user",
        content: "Refunds?",
        result: null,
        created_at: "t1",
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        role: "assistant",
        content: "Within 30 days",
        result: assistantResult,
        created_at: "t2",
      },
    ],
  };
}

// Why: typing the mock with the real `call` signature keeps `mock.calls` correctly typed
// and makes the test fail to compile if the handler's dependency ever changes shape.
function makeCall(impl?: CallFn) {
  return vi.fn<CallFn>(impl);
}

function makeDeps(call: CallFn, signedIn = true): ConversationsHandlerDeps {
  return { appUrl: APP_URL, getSession: async () => (signedIn ? session : null), call };
}

function deleteRequest(origin: string | null = APP_URL): NextRequest {
  const headers = new Headers();
  if (origin !== null) {
    headers.set("origin", origin);
  }
  return new NextRequest(`${APP_URL}/api/conversations/${ID}`, { method: "DELETE", headers });
}

describe("handleListConversations", () => {
  it("returns the conversations in the browser's shape", async () => {
    const call = makeCall(async () => Response.json(listed));
    const response = await handleListConversations(makeDeps(call));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      conversations: [{ id: ID, title: "Refunds?", updatedAt: "2026-10-03T09:05:00Z" }],
    });
  });

  it("answers 401 without a session", async () => {
    const call = makeCall();
    expect((await handleListConversations(makeDeps(call, false))).status).toBe(401);
    expect(call).not.toHaveBeenCalled();
  });

  it("answers 409 when no workspace is selected", async () => {
    const call = makeCall(async () => {
      throw new NoTenantError("none");
    });
    expect((await handleListConversations(makeDeps(call))).status).toBe(409);
  });

  it("answers 502 for a backend answer of the wrong shape", async () => {
    const call = makeCall(async () => Response.json({ unexpected: true }));
    expect((await handleListConversations(makeDeps(call))).status).toBe(502);
  });
});

describe("handleGetConversation", () => {
  it("returns the messages with their stored results", async () => {
    const call = makeCall(async () => Response.json(detail(validResult)));
    const body = await (await handleGetConversation(makeDeps(call), ID)).json();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].result).toEqual(validResult);
    expect(body.messages[0].createdAt).toBe("t1");
  });

  it("shows a stored result that no longer matches the schema as plain text", async () => {
    const call = makeCall(async () => Response.json(detail({ answer: "old shape" })));
    const response = await handleGetConversation(makeDeps(call), ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages[1].result).toBeNull();
    expect(body.messages[1].content).toBe("Within 30 days");
  });

  it("refuses an id that is not a UUID without calling the backend", async () => {
    const call = makeCall();
    expect((await handleGetConversation(makeDeps(call), "not-a-uuid")).status).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });

  it("passes a 404 through", async () => {
    const call = makeCall(async () => new Response(null, { status: 404 }));
    expect((await handleGetConversation(makeDeps(call), ID)).status).toBe(404);
  });
});

describe("handleDeleteConversation", () => {
  it("deletes and answers 204", async () => {
    const call = makeCall(async () => new Response(null, { status: 204 }));
    const response = await handleDeleteConversation(deleteRequest(), makeDeps(call), ID);
    expect(response.status).toBe(204);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      expect.anything(),
      `/conversations/${ID}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it.each([
    ["another origin", "http://evil.example"],
    ["no origin", null],
  ])("refuses a delete with %s before touching the backend", async (_label, origin) => {
    const call = makeCall();
    const response = await handleDeleteConversation(deleteRequest(origin), makeDeps(call), ID);
    expect(response.status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a UUID", async () => {
    const call = makeCall();
    const response = await handleDeleteConversation(deleteRequest(), makeDeps(call), "nope");
    expect(response.status).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });

  it("passes a 404 through", async () => {
    const call = makeCall(async () => new Response(null, { status: 404 }));
    const response = await handleDeleteConversation(deleteRequest(), makeDeps(call), ID);
    expect(response.status).toBe(404);
  });
});
