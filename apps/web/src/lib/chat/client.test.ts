import { describe, expect, it } from "vitest";
import { encodeSse } from "@/lib/sse";
import { readChatEvents } from "./client";
import { chatError } from "./events";

const RESULT = {
  answer: "Hi",
  citations: [],
  retrieved_context: [],
  retrieved_but_uncited_count: 0,
  flagged: false,
  flag_reasons: [],
};

// Why: a stream that closes before a result or an error is a failure, so the reader ends
// it with this error instead of leaving the UI waiting on "Thinking…".
const UNAVAILABLE = { type: "error", data: chatError("unavailable") };

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>) {
  const events = [];
  for await (const event of readChatEvents(body)) {
    events.push(event);
  }
  return events;
}

describe("readChatEvents", () => {
  it("reads stage and result events in order", async () => {
    const chunks = [encodeSse("stage", { stage: "retrieval" }), encodeSse("result", RESULT)];
    expect((await collect(streamOf(chunks))).map((event) => event.type)).toEqual([
      "stage",
      "result",
    ]);
  });

  it("stops after a result and adds no error", async () => {
    expect(await collect(streamOf([encodeSse("result", RESULT)]))).toEqual([
      { type: "result", data: RESULT },
    ]);
  });

  it("copes with an event split across chunks", async () => {
    const pieces = encodeSse("stage", { stage: "grading" }).match(/[\s\S]{1,5}/g) ?? [];
    // The stream ends after the stage with no result, so the reader adds the error.
    expect(await collect(streamOf(pieces))).toEqual([
      { type: "stage", data: { stage: "grading" } },
      UNAVAILABLE,
    ]);
  });

  it("drops an event of the wrong shape and keeps reading", async () => {
    const chunks = [
      encodeSse("stage", { stage: "not-a-real-stage" }),
      encodeSse("stage", { stage: "generation" }),
    ];
    expect(await collect(streamOf(chunks))).toEqual([
      { type: "stage", data: { stage: "generation" } },
      UNAVAILABLE,
    ]);
  });

  it("reports an error when the stream closes after stages but before a result", async () => {
    const chunks = [encodeSse("stage", { stage: "retrieval" })];
    expect(await collect(streamOf(chunks))).toEqual([
      { type: "stage", data: { stage: "retrieval" } },
      UNAVAILABLE,
    ]);
  });

  it("returns an error for an empty stream", async () => {
    expect(await collect(streamOf([]))).toEqual([UNAVAILABLE]);
  });
});
