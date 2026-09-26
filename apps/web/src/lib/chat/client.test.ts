import { describe, expect, it } from "vitest";
import { encodeSse } from "@/lib/sse";
import { readChatEvents } from "./client";

const RESULT = {
  answer: "Hi",
  citations: [],
  retrieved_context: [],
  retrieved_but_uncited_count: 0,
  flagged: false,
  flag_reasons: [],
};

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

  it("copes with an event split across chunks", async () => {
    const pieces = encodeSse("stage", { stage: "grading" }).match(/[\s\S]{1,5}/g) ?? [];
    expect(await collect(streamOf(pieces))).toEqual([
      { type: "stage", data: { stage: "grading" } },
    ]);
  });

  it("drops an event of the wrong shape and keeps reading", async () => {
    const chunks = [
      encodeSse("stage", { stage: "not-a-real-stage" }),
      encodeSse("stage", { stage: "generation" }),
    ];
    expect(await collect(streamOf(chunks))).toEqual([
      { type: "stage", data: { stage: "generation" } },
    ]);
  });

  it("returns nothing for an empty stream", async () => {
    expect(await collect(streamOf([]))).toEqual([]);
  });
});
