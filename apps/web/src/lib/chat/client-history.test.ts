import { describe, expect, it } from "vitest";
import { encodeSse } from "@/lib/sse";
import { readChatEvents } from "./client";

const ID = "11111111-1111-4111-8111-111111111111";
const RESULT = {
  answer: "Within 30 days [1]",
  citations: [],
  retrieved_context: [],
  retrieved_but_uncited_count: 0,
  flagged: false,
  flag_reasons: [],
};

// Each string is delivered as its own chunk, so a result and the history event after it can
// arrive in separate reads, like on a real connection.
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function typesOf(chunks: string[]): Promise<string[]> {
  const types: string[] = [];
  for await (const event of readChatEvents(streamOf(chunks))) {
    types.push(event.type);
  }
  return types;
}

describe("readChatEvents and the history event", () => {
  it("keeps reading after a result and yields the history event", async () => {
    expect(
      await typesOf([encodeSse("result", RESULT), encodeSse("history", { conversationId: ID })]),
    ).toEqual(["result", "history"]);
  });

  it("passes the saved conversation id through", async () => {
    const events = [];
    for await (const event of readChatEvents(
      streamOf([encodeSse("result", RESULT), encodeSse("history", { conversationId: ID })]),
    )) {
      events.push(event);
    }
    expect(events.at(-1)).toEqual({ type: "history", data: { conversationId: ID } });
  });

  it("passes a null conversation id through when the save failed", async () => {
    expect(
      await typesOf([encodeSse("result", RESULT), encodeSse("history", { conversationId: null })]),
    ).toEqual(["result", "history"]);
  });

  it("reads a result and its history event when they arrive in one chunk", async () => {
    expect(
      await typesOf([encodeSse("result", RESULT) + encodeSse("history", { conversationId: ID })]),
    ).toEqual(["result", "history"]);
  });

  it("does not report an error when the stream closes right after a result", async () => {
    expect(await typesOf([encodeSse("result", RESULT)])).toEqual(["result"]);
  });

  it("reports unavailable when the stream closes before any result", async () => {
    expect(await typesOf([encodeSse("stage", { stage: "retrieval" })])).toEqual(["stage", "error"]);
  });

  it("stops at an error event", async () => {
    expect(
      await typesOf([
        encodeSse("error", { code: "blocked", message: "Blocked." }),
        encodeSse("result", RESULT),
      ]),
    ).toEqual(["error"]);
  });
});
