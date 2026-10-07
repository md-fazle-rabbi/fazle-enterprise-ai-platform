import { describe, expect, it } from "vitest";
import { parseChatEvent } from "./events";

const RESULT = {
  answer: "Hi [1]",
  citations: [],
  retrieved_context: [],
  retrieved_but_uncited_count: 0,
  flagged: false,
  flag_reasons: [],
};

describe("parseChatEvent", () => {
  it("reads a stage event", () => {
    expect(parseChatEvent({ event: "stage", data: '{"stage":"retrieval"}' })).toEqual({
      type: "stage",
      data: { stage: "retrieval" },
    });
  });

  it("reads a result event", () => {
    expect(parseChatEvent({ event: "result", data: JSON.stringify(RESULT) })).toEqual({
      type: "result",
      data: RESULT,
    });
  });

  it("reads an error event", () => {
    const error = {
      code: "quota",
      message: "The daily usage limit for this workspace has been reached.",
    };
    expect(parseChatEvent({ event: "error", data: JSON.stringify(error) })).toEqual({
      type: "error",
      data: error,
    });
  });

  it("drops an event of an unknown type", () => {
    expect(parseChatEvent({ event: "mystery", data: "{}" })).toBeNull();
  });

  it("drops a stage event with an unknown stage name", () => {
    expect(parseChatEvent({ event: "stage", data: '{"stage":"teleport"}' })).toBeNull();
  });

  it("drops data that is not valid JSON", () => {
    expect(parseChatEvent({ event: "stage", data: "{not json" })).toBeNull();
  });

  it.each(["result", "error"])("drops a %s event of the wrong shape", (event) => {
    expect(parseChatEvent({ event, data: "{}" })).toBeNull();
  });

  it("reads a history event with a conversation id", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(
      parseChatEvent({ event: "history", data: JSON.stringify({ conversationId: id }) }),
    ).toEqual({
      type: "history",
      data: { conversationId: id },
    });
  });

  it("reads a history event that says nothing was saved", () => {
    expect(parseChatEvent({ event: "history", data: '{"conversationId":null}' })).toEqual({
      type: "history",
      data: { conversationId: null },
    });
  });

  it("drops a history event whose id is not a UUID", () => {
    expect(parseChatEvent({ event: "history", data: '{"conversationId":"nope"}' })).toBeNull();
  });
});
