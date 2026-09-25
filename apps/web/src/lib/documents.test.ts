// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NoTenantError, NotSignedInError } from "@/lib/auth/errors";
import { makeSession } from "@/lib/session/fixtures";
import { loadDocuments, type AuthedFetcher } from "./documents";

const session = { sid: "sid-1", data: makeSession() };
const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";

function fetcherReturning(response: Response) {
  return vi.fn<AuthedFetcher>(async () => response);
}

describe("loadDocuments", () => {
  it("returns the documents the backend lists", async () => {
    const fetcher = fetcherReturning(
      Response.json([{ id: DOCUMENT_ID, source_path: "handbook.md" }]),
    );
    await expect(loadDocuments(fetcher, session)).resolves.toEqual({
      status: "ok",
      documents: [{ id: DOCUMENT_ID, source_path: "handbook.md" }],
    });
    expect(fetcher).toHaveBeenCalledWith("sid-1", session.data, "/documents");
  });

  it("reports the status when the backend answers with an error", async () => {
    const fetcher = fetcherReturning(new Response("boom", { status: 500 }));
    await expect(loadDocuments(fetcher, session)).resolves.toEqual({
      status: "error",
      message: "The backend answered 500",
    });
  });

  it("refuses an answer of the wrong shape", async () => {
    const fetcher = fetcherReturning(Response.json({ unexpected: true }));
    await expect(loadDocuments(fetcher, session)).resolves.toEqual({
      status: "error",
      message: "The backend sent an unexpected answer",
    });
  });

  it("reports a user who has to sign in again", async () => {
    const fetcher = vi.fn<AuthedFetcher>().mockRejectedValue(new NotSignedInError("over"));
    await expect(loadDocuments(fetcher, session)).resolves.toEqual({ status: "signed-out" });
  });

  it("reports a user without a tenant", async () => {
    const fetcher = vi.fn<AuthedFetcher>().mockRejectedValue(new NoTenantError("none"));
    await expect(loadDocuments(fetcher, session)).resolves.toEqual({ status: "no-tenant" });
  });

  it("reports an unreachable backend without leaking the reason", async () => {
    const fetcher = vi
      .fn<AuthedFetcher>()
      .mockRejectedValue(new TypeError("ECONNREFUSED 10.0.0.5"));
    await expect(loadDocuments(fetcher, session)).resolves.toEqual({
      status: "error",
      message: "The backend could not be reached",
    });
  });
});
