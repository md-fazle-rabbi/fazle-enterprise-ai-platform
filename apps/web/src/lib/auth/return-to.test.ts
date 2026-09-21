import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

describe("safeReturnTo", () => {
  it.each(["/", "/chat", "/chat?tenant=1", "/admin/audit#top"])(
    "keeps the local path %s",
    (value) => {
      expect(safeReturnTo(value)).toBe(value);
    },
  );

  it.each([
    null,
    undefined,
    "",
    "chat",
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "/ok\nnext",
    "/a b",
    `/${"x".repeat(600)}`,
    "/\t/evil.example",
    "/\u2028x",
    "//",
  ])("falls back to / for %j", (value) => {
    expect(safeReturnTo(value)).toBe("/");
  });
});