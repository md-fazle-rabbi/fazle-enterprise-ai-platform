import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadDocument } from "./client";
import { MAX_PDF_BYTES } from "./limits";

const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadDocument", () => {
  it("posts the file as multipart form data with no hand written content type", async () => {
    const fetchMock = stubFetch(
      Response.json(
        { status: "ok", kind: "text", documentId: DOCUMENT_ID, deduplicated: false, chunkCount: 3 },
        { status: 201 },
      ),
    );
    const file = new File(["hello"], "note.md");
    await uploadDocument(file);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/documents");
    expect(init.method).toBe("POST");
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("refuses a file over the biggest limit without sending it", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 201 }));
    const big = new File([new Uint8Array(MAX_PDF_BYTES + 1)], "big.pdf");
    const outcome = await uploadDocument(big);
    expect(outcome).toMatchObject({ ok: false, error: { code: "too_large" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a file of exactly the biggest limit", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 500 }));
    await uploadDocument(new File([new Uint8Array(MAX_PDF_BYTES)], "edge.pdf"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "text",
      { status: "ok", kind: "text", documentId: DOCUMENT_ID, deduplicated: false, chunkCount: 4 },
    ],
    [
      "image",
      { status: "ok", kind: "image", documentId: DOCUMENT_ID, deduplicated: true, modality: "x" },
    ],
    [
      "pdf",
      {
        status: "ok",
        kind: "pdf",
        documentId: DOCUMENT_ID,
        deduplicated: false,
        pageCount: 5,
        skippedPages: [2],
      },
    ],
  ])("returns a %s success", async (_kind, body) => {
    stubFetch(Response.json(body, { status: 201 }));
    expect(await uploadDocument(new File(["x"], "a.md"))).toEqual({ ok: true, result: body });
  });

  it("treats a success in the wrong shape as a failure", async () => {
    stubFetch(
      Response.json({ status: "ok", kind: "pdf", documentId: DOCUMENT_ID }, { status: 201 }),
    );
    expect(await uploadDocument(new File(["x"], "a.pdf"))).toMatchObject({
      ok: false,
      error: { code: "unavailable", message: "The server sent an unexpected answer." },
    });
  });

  it("returns the route's own error with its code, message and Retry-After", async () => {
    stubFetch(
      Response.json(
        {
          code: "rate_limited",
          message: "Too many uploads. Try again in 42 seconds.",
          retryAfterSeconds: 42,
        },
        { status: 429 },
      ),
    );
    expect(await uploadDocument(new File(["x"], "a.md"))).toEqual({
      ok: false,
      error: {
        code: "rate_limited",
        message: "Too many uploads. Try again in 42 seconds.",
        retryAfterSeconds: 42,
      },
    });
  });

  it.each([
    ["an HTML error page", new Response("<html>Bad gateway</html>", { status: 502 })],
    ["an unknown code", Response.json({ code: "weird", message: "x" }, { status: 400 })],
    ["an empty message", Response.json({ code: "rejected", message: "" }, { status: 400 })],
    ["no body", new Response(null, { status: 500 })],
  ])("uses fixed text for %s", async (_label, response) => {
    stubFetch(response);
    expect(await uploadDocument(new File(["x"], "a.md"))).toEqual({
      ok: false,
      error: { code: "unavailable", message: "The upload failed. Try again later." },
    });
  });

  it("reports a network failure", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    expect(await uploadDocument(new File(["x"], "a.md"))).toMatchObject({
      ok: false,
      error: { code: "unavailable", message: expect.stringContaining("connection") },
    });
  });
});
