// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { NoTenantError } from "@/lib/auth/errors";
import type { Session } from "@/lib/auth/session";
import { makeSession } from "@/lib/session/fixtures";
import { handleDeleteDocument, type DocumentDeleteHandlerDeps } from "./handler";

const APP_URL = "http://app.test:3000";
const ID = "11111111-1111-4111-8111-111111111111";
const session: Session = { sid: "sid-1", data: makeSession() };

type CallFn = DocumentDeleteHandlerDeps["call"];

function makeCall(impl?: CallFn) {
  return vi.fn<CallFn>(impl);
}

function makeDeps(call: CallFn, signedIn = true): DocumentDeleteHandlerDeps {
  return { appUrl: APP_URL, getSession: async () => (signedIn ? session : null), call };
}

function deleteRequest(origin: string | null = APP_URL): NextRequest {
  const headers = new Headers();
  if (origin !== null) {
    headers.set("origin", origin);
  }
  return new NextRequest(`${APP_URL}/api/documents/${ID}`, { method: "DELETE", headers });
}

describe("handleDeleteDocument", () => {
  it("deletes and answers 204", async () => {
    const call = makeCall(async () => new Response(null, { status: 204 }));
    const response = await handleDeleteDocument(deleteRequest(), makeDeps(call), ID);
    expect(response.status).toBe(204);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      expect.anything(),
      `/documents/${ID}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it.each([
    ["another origin", "http://evil.example"],
    ["no origin", null],
  ])("refuses a delete with %s before touching the backend", async (_label, origin) => {
    const call = makeCall();
    const response = await handleDeleteDocument(deleteRequest(origin), makeDeps(call), ID);
    expect(response.status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    const call = makeCall();
    const response = await handleDeleteDocument(deleteRequest(), makeDeps(call, false), ID);
    expect(response.status).toBe(401);
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a UUID", async () => {
    const call = makeCall();
    const response = await handleDeleteDocument(deleteRequest(), makeDeps(call), "nope");
    expect(response.status).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });

  it("answers 409 when no workspace is selected", async () => {
    const call = makeCall(async () => {
      throw new NoTenantError("none");
    });
    const response = await handleDeleteDocument(deleteRequest(), makeDeps(call), ID);
    expect(response.status).toBe(409);
  });

  it("passes a 404 through", async () => {
    const call = makeCall(async () => new Response(null, { status: 404 }));
    const response = await handleDeleteDocument(deleteRequest(), makeDeps(call), ID);
    expect(response.status).toBe(404);
  });

  it("answers 502 when the backend fails", async () => {
    const call = makeCall(async () => new Response(null, { status: 500 }));
    const response = await handleDeleteDocument(deleteRequest(), makeDeps(call), ID);
    expect(response.status).toBe(502);
  });
});
