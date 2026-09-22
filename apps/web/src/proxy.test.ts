// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function request(path: string, cookie?: string) {
  const url = `http://app.test:3000${path}`;
  return new NextRequest(url, cookie ? { headers: { cookie } } : undefined);
}

describe("proxy", () => {
  it("lets a request with a session cookie through", () => {
    const response = proxy(request("/chat", "fazle_sid=abc"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("accepts the __Host- cookie name used over https", () => {
    const response = proxy(request("/chat", "__Host-fazle_sid=abc"));
    expect(response.status).toBe(200);
  });

  it("sends a request without a session cookie to the login page and remembers the target", () => {
    const response = proxy(request("/chat?tenant=1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://app.test:3000/login?returnTo=%2Fchat%3Ftenant%3D1",
    );
  });

  it("never remembers an unsafe target", () => {
    const response = proxy(request("//evil.example/x"));
    expect(response.headers.get("location")).toBe("http://app.test:3000/login?returnTo=%2F");
  });
});
