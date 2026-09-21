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

  it("uses local Redis database 1 and an 8 hour session by default", () => {
    const parsed = parseEnv({});
    expect(parsed.REDIS_URL).toBe("redis://localhost:6379/1");
    expect(parsed.SESSION_TTL_SECONDS).toBe(28_800);
  });

  it("reads the session lifetime from a string", () => {
    expect(parseEnv({ SESSION_TTL_SECONDS: "3600" }).SESSION_TTL_SECONDS).toBe(3_600);
  });

  it.each(["10", "abc", "9999999"])("rejects the session lifetime %s", (value) => {
    expect(() => parseEnv({ SESSION_TTL_SECONDS: value })).toThrow(/SESSION_TTL_SECONDS/);
  });

  it("rejects a Redis URL with the wrong scheme", () => {
    expect(() => parseEnv({ REDIS_URL: "http://localhost:6379/1" })).toThrow(/REDIS_URL/);
  });
});
