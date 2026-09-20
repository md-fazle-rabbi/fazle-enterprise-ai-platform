import { describe, expect, it } from "vitest";
import { parseEnv } from "@/env";

describe("parseEnv", () => {
  it("falls back to the local backend when BACKEND_URL is unset", () => {
    expect(parseEnv({}).BACKEND_URL).toBe("http://localhost:8000");
  });

  it("accepts an origin", () => {
    expect(parseEnv({ BACKEND_URL: "http://backend:8000" }).BACKEND_URL).toBe(
      "http://backend:8000",
    );
  });

  it.each(["localhost:8000", "not a url", "ftp://backend"])("rejects %s", (value) => {
    expect(() => parseEnv({ BACKEND_URL: value })).toThrow(/BACKEND_URL/);
  });

  it("rejects a URL that carries a path", () => {
    expect(() => parseEnv({ BACKEND_URL: "http://backend:8000/api" })).toThrow(/BACKEND_URL/);
  });
});
