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
    expect(proxy(request("/chat", "__Host-fazle_sid=abc")).status).toBe(200);
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

  it("does not redirect a cookie-less visit to /login itself", () => {
    const response = proxy(request("/login"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets an already signed in visitor pass through /login unchanged", () => {
    expect(proxy(request("/login", "fazle_sid=abc")).status).toBe(200);
  });

  it("sets a Content-Security-Policy header on a passed-through response", () => {
    const csp = proxy(request("/chat", "fazle_sid=abc")).headers.get("content-security-policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("sets a Content-Security-Policy header on the redirect to login too", () => {
    expect(proxy(request("/chat")).headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
  });

  it("uses a different nonce for every request", () => {
    const nonceOf = (csp: string | null) => csp?.match(/nonce-([^']+)/)?.[1];
    const first = nonceOf(
      proxy(request("/chat", "fazle_sid=abc")).headers.get("content-security-policy"),
    );
    const second = nonceOf(
      proxy(request("/chat", "fazle_sid=abc")).headers.get("content-security-policy"),
    );
    expect(first).toBeDefined();
    expect(first).not.toBe(second);
  });
});
