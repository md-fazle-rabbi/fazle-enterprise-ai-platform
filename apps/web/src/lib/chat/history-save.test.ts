import { describe, expect, it, vi } from "vitest";
import type { ChatResult } from "./events";
import { saveExchange, type BackendCall } from "./history-save";

const RESULT: ChatResult = {
  answer: "Within 30 days [1]",
  citations: [],
  retrieved_context: [],
  retrieved_but_uncited_count: 0,
  flagged: false,
  flag_reasons: [],
};
const EXISTING = "11111111-1111-4111-8111-111111111111";
const CREATED = "22222222-2222-4222-8222-222222222222";

function input(conversationId: string | null) {
  return { conversationId, question: "Refunds?", result: RESULT };
}

function callWith(answers: Array<Response | Error>) {
  const queue = [...answers];
  const call = vi.fn<BackendCall>(async () => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error("Unexpected extra backend call");
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
  return call;
}

const created = () => Response.json({ id: CREATED }, { status: 201 });
const saved = () => Response.json([], { status: 201 });
const status = (code: number) => new Response(null, { status: code });

describe("saveExchange", () => {
  it("creates a conversation, saves into it and returns its id", async () => {
    const call = callWith([created(), saved()]);
    await expect(saveExchange(call, input(null))).resolves.toBe(CREATED);
    expect(call.mock.calls[0]?.[0]).toBe("/conversations");
    expect(call.mock.calls[1]?.[0]).toBe(`/conversations/${CREATED}/exchanges`);
    const body = JSON.parse(call.mock.calls[1]?.[1]?.body as string);
    expect(body).toEqual({ question: "Refunds?", result: RESULT });
  });

  it("saves straight into an existing conversation", async () => {
    const call = callWith([saved()]);
    await expect(saveExchange(call, input(EXISTING))).resolves.toBe(EXISTING);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("carries on in a new conversation when the existing one is gone", async () => {
    const call = callWith([status(404), created(), saved()]);
    await expect(saveExchange(call, input(EXISTING))).resolves.toBe(CREATED);
  });

  it("gives up without creating anything when saving into an existing one fails", async () => {
    const call = callWith([status(500)]);
    await expect(saveExchange(call, input(EXISTING))).resolves.toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("returns null when a conversation cannot be created", async () => {
    const call = callWith([status(409)]);
    await expect(saveExchange(call, input(null))).resolves.toBeNull();
  });

  it("returns null when the backend's answer to a create is not an id", async () => {
    const call = callWith([Response.json({ unexpected: true }, { status: 201 })]);
    await expect(saveExchange(call, input(null))).resolves.toBeNull();
  });

  it("deletes the conversation it just created when the save into it fails", async () => {
    const call = callWith([created(), status(500), status(204)]);
    await expect(saveExchange(call, input(null))).resolves.toBeNull();
    expect(call.mock.calls[2]?.[0]).toBe(`/conversations/${CREATED}`);
    expect(call.mock.calls[2]?.[1]?.method).toBe("DELETE");
  });
});
