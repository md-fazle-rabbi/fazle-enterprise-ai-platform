import { describe, expect, it } from "vitest";
import { parseEnv } from "@/env";

const required = { KEYCLOAK_WEB_CLIENT_SECRET: "test-client-secret-0123456789" };

describe("parseEnv defaults", () => {
  it("falls back to the local backend, app, Keycloak and Redis", () => {
    expect(parseEnv(required)).toEqual({
      BACKEND_URL: "http://localhost:8000",
      APP_URL: "http://localhost:3000",
      KEYCLOAK_PUBLIC_URL: "http://localhost:8080",
      KEYCLOAK_INTERNAL_URL: "http://localhost:8080",
      KEYCLOAK_REALM: "agent-mesh",
      KEYCLOAK_CLIENT_ID: "fazle-web",
      KEYCLOAK_WEB_CLIENT_SECRET: required.KEYCLOAK_WEB_CLIENT_SECRET,
      REDIS_URL: "redis://localhost:6379/1",
      SESSION_TTL_SECONDS: 28_800,
    });
  });
});

describe.each(["BACKEND_URL", "APP_URL", "KEYCLOAK_PUBLIC_URL", "KEYCLOAK_INTERNAL_URL"] as const)(
  "%s",
  (name) => {
    it("accepts an origin and drops a trailing slash", () => {
      expect(parseEnv({ ...required, [name]: "http://backend:8000/" })[name]).toBe(
        "http://backend:8000",
      );
    });

    it.each(["localhost:8000", "not a url", "ftp://backend"])("rejects %s", (value) => {
      expect(() => parseEnv({ ...required, [name]: value })).toThrow(new RegExp(name));
    });

    it("rejects a URL that carries a path", () => {
      expect(() => parseEnv({ ...required, [name]: "http://backend:8000/api" })).toThrow(
        new RegExp(name),
      );
    });
  },
);

describe("parseEnv secrets and sessions", () => {
  it("requires the client secret", () => {
    expect(() => parseEnv({})).toThrow(/KEYCLOAK_WEB_CLIENT_SECRET/);
  });

  it("rejects a short client secret", () => {
    expect(() => parseEnv({ KEYCLOAK_WEB_CLIENT_SECRET: "short" })).toThrow(
      /KEYCLOAK_WEB_CLIENT_SECRET/,
    );
  });

  it("rejects a realm name with a slash", () => {
    expect(() => parseEnv({ ...required, KEYCLOAK_REALM: "a/b" })).toThrow(/KEYCLOAK_REALM/);
  });

  it("reads the session lifetime from a string", () => {
    expect(parseEnv({ ...required, SESSION_TTL_SECONDS: "3600" }).SESSION_TTL_SECONDS).toBe(3_600);
  });

  it.each(["10", "abc", "9999999"])("rejects the session lifetime %s", (value) => {
    expect(() => parseEnv({ ...required, SESSION_TTL_SECONDS: value })).toThrow(
      /SESSION_TTL_SECONDS/,
    );
  });

  it("rejects a Redis URL with the wrong scheme", () => {
    expect(() => parseEnv({ ...required, REDIS_URL: "http://localhost:6379/1" })).toThrow(
      /REDIS_URL/,
    );
  });
});
