// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteDocument } from "./client";

const ID = "11111111-1111-4111-8111-111111111111";

function stubFetch(outcome: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deleteDocument", () => {
  it("sends a DELETE to the document's route and reports success", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    expect(await deleteDocument(ID)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(`/api/documents/${ID}`, { method: "DELETE" });
  });

  it("treats a document that is already gone as deleted", async () => {
    stubFetch(new Response(null, { status: 404 }));
    expect(await deleteDocument(ID)).toBe(true);
  });

  it("reports failure for a server error", async () => {
    stubFetch(new Response(null, { status: 502 }));
    expect(await deleteDocument(ID)).toBe(false);
  });

  it("reports failure when the request cannot be sent", async () => {
    stubFetch(new Error("offline"));
    expect(await deleteDocument(ID)).toBe(false);
  });
});
