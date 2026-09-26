import { describe, expect, it } from "vitest";
import { sourceAnchorId, splitAnswer } from "./citations";

describe("splitAnswer", () => {
  it("splits text around a marker in the middle", () => {
    expect(splitAnswer("Within 30 days [1] of purchase.")).toEqual([
      { type: "text", text: "Within 30 days " },
      { type: "citation", index: 1 },
      { type: "text", text: " of purchase." },
    ]);
  });

  it("handles a marker at the very start", () => {
    expect(splitAnswer("[1] is the source.")).toEqual([
      { type: "citation", index: 1 },
      { type: "text", text: " is the source." },
    ]);
  });

  it("handles a marker at the very end", () => {
    expect(splitAnswer("See the policy [2]")).toEqual([
      { type: "text", text: "See the policy " },
      { type: "citation", index: 2 },
    ]);
  });

  it("handles two markers with nothing between them", () => {
    expect(splitAnswer("[1][2]")).toEqual([
      { type: "citation", index: 1 },
      { type: "citation", index: 2 },
    ]);
  });

  it("returns one text part for an answer with no markers", () => {
    expect(splitAnswer("No sources here.")).toEqual([{ type: "text", text: "No sources here." }]);
  });

  it("reads a multi-digit index", () => {
    expect(splitAnswer("[12]")).toEqual([{ type: "citation", index: 12 }]);
  });

  it("returns nothing for an empty answer", () => {
    expect(splitAnswer("")).toEqual([]);
  });
});

describe("sourceAnchorId", () => {
  it("combines the turn id and the index", () => {
    expect(sourceAnchorId("turn-1", 3)).toBe("source-turn-1-3");
  });
});
