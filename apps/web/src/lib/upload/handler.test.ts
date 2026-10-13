// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { NoTenantError, NotSignedInError } from "@/lib/auth/errors";
import type { Session } from "@/lib/auth/session";
import type { RateDecision, StreamSlot } from "@/lib/rate-limit/limiter";
import { makeSession } from "@/lib/session/fixtures";
import { handleUpload, type UploadHandlerDeps } from "./handler";
import { BACKEND_TIMEOUT_MS } from "./forward";
import { MAX_PDF_BYTES, MAX_REQUEST_BYTES, MIB } from "./limits";

const APP_URL = "http://app.test:3000";
const URL_ = `${APP_URL}/api/documents`;
const session: Session = { sid: "sid-1", data: makeSession() };
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];

function bytesWith(header: number[], length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  bytes.set(header);
  return bytes;
}

function formWith(name: string, content: Uint8Array<ArrayBuffer> | string): FormData {
  const form = new FormData();
  form.append("file", new File([content], name));
  return form;
}

function uploadRequest(form: FormData, origin: string | null = APP_URL): NextRequest {
  const headers = new Headers();
  if (origin !== null) {
    headers.set("origin", origin);
  }
  return new NextRequest(URL_, { method: "POST", headers, body: form });
}

type ForwardFn = UploadHandlerDeps["forward"];

const textAnswer = () =>
  Response.json({ document_id: DOCUMENT_ID, chunk_count: 3, deduplicated: false }, { status: 201 });

function makeDeps(
  options: {
    signedIn?: boolean;
    decision?: RateDecision;
    slot?: StreamSlot | null;
    forward?: ForwardFn;
  } = {},
) {
  const release = vi.fn(async () => undefined);
  const consumeRequest = vi.fn(
    async (_userId: string): Promise<RateDecision> =>
      options.decision ?? { allowed: true, remaining: 9 },
  );
  const acquireUpload = vi.fn(async (_userId: string): Promise<StreamSlot | null> =>
    options.slot === undefined ? { release } : options.slot,
  );
  const forward = vi.fn<ForwardFn>(options.forward ?? (async () => textAnswer()));
  const getSession = vi.fn(async () => (options.signedIn === false ? null : session));
  const deps: UploadHandlerDeps = {
    appUrl: APP_URL,
    getSession,
    limits: { consumeRequest, acquireUpload },
    forward,
  };
  return { deps, getSession, consumeRequest, acquireUpload, release, forward };
}

describe("handleUpload: checks before the body", () => {
  it.each([
    ["another origin", "http://evil.example"],
    ["no origin", null],
  ])("refuses %s before looking at the session", async (_label, origin) => {
    const { deps, getSession, consumeRequest } = makeDeps();
    const response = await handleUpload(uploadRequest(formWith("a.txt", "hi"), origin), deps);
    expect(response.status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
    expect(consumeRequest).not.toHaveBeenCalled();
  });

  it("refuses a body that is not multipart", async () => {
    const { deps } = makeDeps();
    const request = new NextRequest(URL_, {
      method: "POST",
      headers: { origin: APP_URL, "content-type": "application/json" },
      body: "{}",
    });
    expect((await handleUpload(request, deps)).status).toBe(415);
  });

  it("answers 401 without a session, and without touching the limiters", async () => {
    const { deps, consumeRequest, acquireUpload } = makeDeps({ signedIn: false });
    const response = await handleUpload(uploadRequest(formWith("a.txt", "hi")), deps);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "signed_out" });
    expect(consumeRequest).not.toHaveBeenCalled();
    expect(acquireUpload).not.toHaveBeenCalled();
  });

  it("answers 429 with Retry-After when the rate limit is used up, and takes no slot", async () => {
    const { deps, acquireUpload, forward } = makeDeps({
      decision: { allowed: false, retryAfterSeconds: 42 },
    });
    const response = await handleUpload(uploadRequest(formWith("a.txt", "hi")), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(await response.json()).toMatchObject({ code: "rate_limited", retryAfterSeconds: 42 });
    expect(acquireUpload).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  it("counts the request against the signed in user", async () => {
    const { deps, consumeRequest } = makeDeps();
    await handleUpload(uploadRequest(formWith("a.txt", "hi")), deps);
    expect(consumeRequest).toHaveBeenCalledWith(session.data.user.id);
  });

  it("answers 429 when the user already has an upload running", async () => {
    const { deps, forward } = makeDeps({ slot: null });
    const response = await handleUpload(uploadRequest(formWith("a.txt", "hi")), deps);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "upload_in_progress" });
    expect(forward).not.toHaveBeenCalled();
  });
});

describe("handleUpload: the size of the body", () => {
  it("refuses a declared length over the limit without reading the body", async () => {
    const { deps, acquireUpload } = makeDeps();
    const request = new NextRequest(URL_, {
      method: "POST",
      headers: {
        origin: APP_URL,
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(MAX_REQUEST_BYTES + 1),
      },
      body: "tiny",
    });
    const response = await handleUpload(request, deps);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "too_large" });
    expect(acquireUpload).not.toHaveBeenCalled();
  });

  it("stops a streamed body that has no length once it passes the limit", async () => {
    const { deps, forward, release } = makeDeps();
    const chunk = 1 * MIB;
    const total = 50 * MIB;
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= total) {
          controller.close();
          return;
        }
        sent += chunk;
        controller.enqueue(new Uint8Array(chunk));
      },
    });
    // Why: a Request is built first because its init accepts `duplex`, which Node needs for a
    // streamed body. NextRequest wraps it.
    const request = new NextRequest(
      new Request(URL_, {
        method: "POST",
        headers: { origin: APP_URL, "content-type": "multipart/form-data; boundary=x" },
        body,
        duplex: "half",
      } as RequestInit),
    );
    const response = await handleUpload(request, deps);
    expect(response.status).toBe(413);
    // Why: a handler that read the whole 50 MiB before refusing would have pulled it all.
    expect(sent).toBeLessThan(total);
    expect(forward).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("refuses a PDF one byte over its limit with the limit in the message", async () => {
    const { deps, forward } = makeDeps();
    const file = bytesWith(PDF, MAX_PDF_BYTES + 1);
    const response = await handleUpload(uploadRequest(formWith("big.pdf", file)), deps);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: "too_large",
      message: "The file is too large. The limit is 10 MiB.",
    });
    expect(forward).not.toHaveBeenCalled();
  });
});

describe("handleUpload: the form", () => {
  it("answers 400 when there is no file field", async () => {
    const { deps, forward } = makeDeps();
    const form = new FormData();
    form.append("note", "hello");
    const response = await handleUpload(uploadRequest(form), deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request" });
    expect(forward).not.toHaveBeenCalled();
  });

  it("answers 400 when the file field is plain text and not a file", async () => {
    const { deps } = makeDeps();
    const form = new FormData();
    form.append("file", "not a file");
    expect((await handleUpload(uploadRequest(form), deps)).status).toBe(400);
  });

  it("answers 400 when there are two files", async () => {
    const { deps, forward } = makeDeps();
    const form = formWith("a.txt", "one");
    form.append("file", new File(["two"], "b.txt"));
    expect((await handleUpload(uploadRequest(form), deps)).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });
});

describe("handleUpload: the file", () => {
  it.each([
    ["an empty file", "a.pdf", new Uint8Array(0), 400, "empty_file"],
    ["an unsupported type", "a.exe", bytesWith([0x4d, 0x5a], 64), 415, "unsupported_type"],
    [
      "a GIF",
      "a.gif",
      bytesWith([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 64),
      415,
      "unsupported_type",
    ],
    ["a binary file named .txt", "a.txt", bytesWith(PNG, 64), 422, "invalid_file"],
  ])("refuses %s before the backend", async (_label, name, content, status, code) => {
    const { deps, forward, release } = makeDeps();
    const response = await handleUpload(uploadRequest(formWith(name, content)), deps);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(forward).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("handleUpload: sending to the backend", () => {
  it("sends a text file to /ingest and answers 201", async () => {
    const { deps, forward } = makeDeps();
    const response = await handleUpload(
      uploadRequest(formWith("refunds.md", "# Refunds\nWithin 30 days.")),
      deps,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      kind: "text",
      documentId: DOCUMENT_ID,
      deduplicated: false,
      chunkCount: 3,
    });
    const [calledSession, path, init] = forward.mock.calls[0] ?? [];
    expect(calledSession).toBe(session);
    expect(path).toBe("/ingest");
    expect(JSON.parse(String(init?.body))).toEqual({
      source_path: "refunds.md",
      text: "# Refunds\nWithin 30 days.",
    });
    expect(init?.timeoutMs).toBe(BACKEND_TIMEOUT_MS.text);
  });

  it("sends an image to /ingest/image with the same bytes", async () => {
    const png = bytesWith(PNG, 200);
    png.fill(7, 8);
    const { deps, forward } = makeDeps({
      forward: async () =>
        Response.json(
          { document_id: DOCUMENT_ID, modality: "image_vision", deduplicated: false },
          { status: 201 },
        ),
    });
    const response = await handleUpload(uploadRequest(formWith("scan.png", png)), deps);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ kind: "image", modality: "image_vision" });
    const [, path, init] = forward.mock.calls[0] ?? [];
    expect(path).toBe("/ingest/image");
    const sent = (init?.body as FormData).get("file") as File;
    expect(sent.name).toBe("scan.png");
    expect(sent.type).toBe("image/png");
    expect(new Uint8Array(await sent.arrayBuffer())).toEqual(png);
  });

  it("sends a PDF to /ingest/pdf with the longer timeout and reports skipped pages", async () => {
    const { deps, forward } = makeDeps({
      forward: async () =>
        Response.json(
          { document_id: DOCUMENT_ID, page_count: 4, deduplicated: false, skipped_pages: [3] },
          { status: 201 },
        ),
    });
    const response = await handleUpload(
      uploadRequest(formWith("paper.pdf", bytesWith(PDF, 500))),
      deps,
    );
    expect(await response.json()).toMatchObject({ kind: "pdf", pageCount: 4, skippedPages: [3] });
    const [, path, init] = forward.mock.calls[0] ?? [];
    expect(path).toBe("/ingest/pdf");
    expect(init?.timeoutMs).toBe(BACKEND_TIMEOUT_MS.pdf);
  });

  it("forwards only the cleaned file name", async () => {
    const { deps, forward } = makeDeps();
    await handleUpload(uploadRequest(formWith("../../etc/passw\u202Ed.md", "hello")), deps);
    const [, , init] = forward.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body)).source_path).toBe("passwd.md");
  });

  it("releases the slot after a success", async () => {
    const { deps, release } = makeDeps();
    await handleUpload(uploadRequest(formWith("a.md", "hello")), deps);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("handleUpload: when the backend or the session fails", () => {
  it("passes a 422 refusal through with its own text and the same status", async () => {
    const { deps, release } = makeDeps({
      forward: async () =>
        Response.json({ detail: "The PDF has 25 pages. The limit is 20." }, { status: 422 }),
    });
    const response = await handleUpload(uploadRequest(formWith("a.pdf", bytesWith(PDF, 64))), deps);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: "rejected",
      message: "The PDF has 25 pages. The limit is 20.",
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("passes a 503 through with Retry-After", async () => {
    const { deps } = makeDeps({
      forward: async () => new Response(null, { status: 503, headers: { "Retry-After": "9" } }),
    });
    const response = await handleUpload(uploadRequest(formWith("a.md", "hello")), deps);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("9");
    expect(await response.json()).toMatchObject({ code: "busy", retryAfterSeconds: 9 });
  });

  it("hides the body of a 500", async () => {
    const { deps } = makeDeps({
      forward: async () => Response.json({ detail: "Traceback secret" }, { status: 500 }),
    });
    const response = await handleUpload(uploadRequest(formWith("a.md", "hello")), deps);
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("Traceback");
  });

  it.each([
    ["a session that ended", new NotSignedInError("gone"), 401, "signed_out"],
    ["no workspace", new NoTenantError("none"), 409, "no_workspace"],
    ["a timeout", new DOMException("timed out", "TimeoutError"), 504, "timeout"],
    ["a dropped connection", new TypeError("fetch failed"), 502, "unavailable"],
  ])("answers %s with %i", async (_label, error, status, code) => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps, release } = makeDeps({
      forward: async () => {
        throw error;
      },
    });
    const response = await handleUpload(uploadRequest(formWith("a.md", "hello")), deps);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(release).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });

  it("does not log the error object, only its message", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secret = new TypeError("fetch failed");
    Object.assign(secret, { token: "Bearer top-secret" });
    const { deps } = makeDeps({
      forward: async () => {
        throw secret;
      },
    });
    await handleUpload(uploadRequest(formWith("a.md", "hello")), deps);
    expect(errorLog).toHaveBeenCalledWith("Upload to the backend failed:", "fetch failed");
    errorLog.mockRestore();
  });
});
