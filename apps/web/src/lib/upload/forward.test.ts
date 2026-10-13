// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  BACKEND_TIMEOUT_MS,
  LONGEST_BACKEND_TIMEOUT_MS,
  buildBackendRequest,
  readBackendResponse,
  type UploadKind,
} from "./forward";

const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";

describe("buildBackendRequest", () => {
  it("sends text to /ingest as JSON with the cleaned name as source_path", () => {
    const request = buildBackendRequest(
      { ok: true, kind: "text", text: "Within 30 days." },
      "refunds.md",
      new Uint8Array(0),
    );
    expect(request.path).toBe("/ingest");
    expect(request.init.method).toBe("POST");
    expect(request.init.timeoutMs).toBe(BACKEND_TIMEOUT_MS.text);
    expect(JSON.parse(String(request.init.body))).toEqual({
      source_path: "refunds.md",
      text: "Within 30 days.",
    });
  });

  it.each([
    ["png", "/ingest/image", "image/png", BACKEND_TIMEOUT_MS.image],
    ["jpeg", "/ingest/image", "image/jpeg", BACKEND_TIMEOUT_MS.image],
    ["webp", "/ingest/image", "image/webp", BACKEND_TIMEOUT_MS.image],
    ["pdf", "/ingest/pdf", "application/pdf", BACKEND_TIMEOUT_MS.pdf],
  ] as const)("sends %s as multipart to %s", async (kind, path, mime, timeoutMs) => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const request = buildBackendRequest({ ok: true, kind }, "scan.bin", bytes);
    expect(request.path).toBe(path);
    expect(request.init.timeoutMs).toBe(timeoutMs);
    // Why: fetch has to write the Content-Type itself, because only it knows the boundary.
    expect(request.init.headers).toBeUndefined();
    expect(request.init.body).toBeInstanceOf(FormData);
    const sent = (request.init.body as FormData).get("file");
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe("scan.bin");
    expect((sent as File).type).toBe(mime);
    expect(new Uint8Array(await (sent as File).arrayBuffer())).toEqual(bytes);
  });

  it("allows the slot to outlive the longest call", () => {
    expect(LONGEST_BACKEND_TIMEOUT_MS).toBe(BACKEND_TIMEOUT_MS.pdf);
  });
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers });
}

describe("readBackendResponse: success", () => {
  it("reads a text answer", async () => {
    const outcome = await readBackendResponse(
      "text",
      jsonResponse(201, { document_id: DOCUMENT_ID, chunk_count: 4, deduplicated: false }),
    );
    expect(outcome).toEqual({
      ok: true,
      body: {
        status: "ok",
        kind: "text",
        documentId: DOCUMENT_ID,
        deduplicated: false,
        chunkCount: 4,
      },
    });
  });

  it("reads an image answer", async () => {
    const outcome = await readBackendResponse(
      "image",
      jsonResponse(201, { document_id: DOCUMENT_ID, modality: "image_vision", deduplicated: true }),
    );
    expect(outcome).toMatchObject({
      ok: true,
      body: { kind: "image", modality: "image_vision", deduplicated: true },
    });
  });

  it("reads a PDF answer with its skipped pages", async () => {
    const outcome = await readBackendResponse(
      "pdf",
      jsonResponse(201, {
        document_id: DOCUMENT_ID,
        page_count: 5,
        deduplicated: false,
        skipped_pages: [2, 4],
      }),
    );
    expect(outcome).toMatchObject({
      ok: true,
      body: { kind: "pdf", pageCount: 5, skippedPages: [2, 4] },
    });
  });

  it.each<[UploadKind, unknown]>([
    ["text", { document_id: "not-a-guid", chunk_count: 1, deduplicated: false }],
    ["text", { document_id: DOCUMENT_ID, chunk_count: "4", deduplicated: false }],
    ["image", { document_id: DOCUMENT_ID, deduplicated: false }],
    ["pdf", { document_id: DOCUMENT_ID, page_count: 1, deduplicated: false }],
    ["text", null],
  ])("treats a %s answer in the wrong shape as a backend fault", async (kind, body) => {
    const outcome = await readBackendResponse(kind, jsonResponse(201, body));
    expect(outcome).toMatchObject({
      ok: false,
      status: 502,
      error: { code: "unavailable", message: "The document service sent an unexpected answer." },
    });
  });
});

describe("readBackendResponse: refusals", () => {
  it.each([
    [400, { detail: "Request blocked: possible prompt injection detected." }, "rejected"],
    [413, { detail: "Request body is too large." }, "too_large"],
    [415, { detail: "Unsupported image. Upload a PNG, JPEG or WEBP file." }, "unsupported_type"],
    [422, { detail: "The PDF has 25 pages. The limit is 20." }, "rejected"],
  ])("passes the backend's own text through for %i", async (status, body, code) => {
    const outcome = await readBackendResponse("pdf", jsonResponse(status, body));
    expect(outcome).toEqual({
      ok: false,
      status,
      error: { code, message: body.detail },
    });
  });

  it.each([400, 413, 415, 422])(
    "uses fixed text for %i when detail is not a string",
    async (status) => {
      // Why: FastAPI's own validation errors send detail as a list of objects.
      const outcome = await readBackendResponse(
        "text",
        jsonResponse(status, { detail: [{ loc: ["body", "text"], msg: "field required" }] }),
      );
      expect(outcome).toMatchObject({ ok: false, status });
      expect(JSON.stringify(outcome)).not.toContain("field required");
    },
  );

  it("uses fixed text when the refusal has no body", async () => {
    const outcome = await readBackendResponse("text", new Response(null, { status: 400 }));
    expect(outcome).toEqual({
      ok: false,
      status: 400,
      error: { code: "rejected", message: "The file was refused." },
    });
  });

  it("cuts a very long detail", async () => {
    const outcome = await readBackendResponse(
      "text",
      jsonResponse(422, { detail: "x".repeat(1_000) }),
    );
    expect(outcome.ok === false && outcome.error.message).toHaveLength(300);
  });

  it("never shows the body of a server error", async () => {
    const outcome = await readBackendResponse(
      "text",
      jsonResponse(500, { detail: "Traceback (most recent call last): secret path /app/db.py" }),
    );
    expect(outcome).toEqual({
      ok: false,
      status: 502,
      error: { code: "unavailable", message: "The document service is not available right now." },
    });
  });

  it("passes Retry-After through on a 503", async () => {
    const outcome = await readBackendResponse(
      "pdf",
      jsonResponse(503, { detail: "busy" }, { "Retry-After": "17" }),
    );
    expect(outcome).toEqual({
      ok: false,
      status: 503,
      error: {
        code: "busy",
        message: "The embedding service is busy. Try again in 17 seconds.",
        retryAfterSeconds: 17,
      },
    });
  });

  it.each([[{}], [{ "Retry-After": "soon" }], [{ "Retry-After": "-3" }]])(
    "falls back to fixed text for a 503 with headers %j",
    async (headers) => {
      const outcome = await readBackendResponse("pdf", jsonResponse(503, {}, headers));
      expect(outcome).toEqual({
        ok: false,
        status: 503,
        error: { code: "busy", message: "The embedding service is busy. Try again in a minute." },
      });
    },
  );

  it.each([
    [401, 401, "signed_out"],
    [403, 403, "forbidden"],
    [404, 502, "unavailable"],
    [502, 502, "unavailable"],
  ])("maps backend %i to %i %s", async (backend, status, code) => {
    const outcome = await readBackendResponse("text", jsonResponse(backend, { detail: "x" }));
    expect(outcome).toMatchObject({ ok: false, status, error: { code } });
  });
});
