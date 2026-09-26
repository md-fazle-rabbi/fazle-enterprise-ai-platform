import { describe, expect, it } from "vitest";
import { createSseParser, encodeSse } from "./sse";

describe("createSseParser", () => {
  it("parses one complete event", () => {
    const parser = createSseParser();
    expect(parser.feed('event: stage\ndata: {"stage":"retrieval"}\n\n')).toEqual([
      { event: "stage", data: '{"stage":"retrieval"}' },
    ]);
  });

  it("waits for the rest of an event that is split across chunks", () => {
    const parser = createSseParser();
    expect(parser.feed("event: sta")).toEqual([]);
    expect(parser.feed("ge\ndata: 1\n")).toEqual([]);
    expect(parser.feed("\n")).toEqual([{ event: "stage", data: "1" }]);
  });

  it("accepts CRLF line endings", () => {
    const parser = createSseParser();
    expect(parser.feed("event: a\r\ndata: 1\r\n\r\n")).toEqual([{ event: "a", data: "1" }]);
  });

  it("does not end a line on a CR that ends a chunk", () => {
    const parser = createSseParser();
    expect(parser.feed("data: a\r")).toEqual([]);
    expect(parser.feed("\n\r\n")).toEqual([{ event: "message", data: "a" }]);
  });

  it("joins several data lines with a newline", () => {
    const parser = createSseParser();
    expect(parser.feed("data: one\ndata: two\n\n")).toEqual([
      { event: "message", data: "one\ntwo" },
    ]);
  });

  it("skips comments and unknown fields, and names an event message by default", () => {
    const parser = createSseParser();
    expect(parser.feed(": ping\n\nid: 5\nretry: 10\ndata: y\n\n")).toEqual([
      { event: "message", data: "y" },
    ]);
  });

  it("ignores an event without data", () => {
    const parser = createSseParser();
    expect(parser.feed("event: x\n\n")).toEqual([]);
  });

  it("refuses a frame that never ends", () => {
    const parser = createSseParser();
    expect(() => parser.feed("x".repeat(1_000_001))).toThrow(/too large/);
  });
});

describe("encodeSse", () => {
  it("writes an event with JSON data that the parser reads back", () => {
    const frame = encodeSse("stage", { stage: "retrieval" });
    expect(frame).toBe('event: stage\ndata: {"stage":"retrieval"}\n\n');
    expect(createSseParser().feed(frame)).toEqual([
      { event: "stage", data: '{"stage":"retrieval"}' },
    ]);
  });
});
