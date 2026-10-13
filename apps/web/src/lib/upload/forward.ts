import * as z from "zod";
import type { BackendInit } from "@/lib/backend";
import { uploadError, type UploadError, type UploadSuccess } from "./result";
import { MIME_TYPES, type BinaryKind, type Classified } from "./sniff";

export type AcceptedFile = Extract<Classified, { ok: true }>;

export type BackendRequest = { path: string; init: BackendInit };

// Why: starting guesses, not measurements. The backend embeds every chunk or page through the
// shared free tier Voyage quota (3 requests a minute), so a slow answer is normal. A PDF waits
// longest because every page is a vision call. They are set once here and get measured against
// a real 20 page PDF before they are trusted (ADR-035).
export const BACKEND_TIMEOUT_MS = { text: 60_000, image: 60_000, pdf: 180_000 } as const;
export const LONGEST_BACKEND_TIMEOUT_MS = Math.max(...Object.values(BACKEND_TIMEOUT_MS));

export type UploadKind = "text" | "image" | "pdf";

export function uploadKind(file: AcceptedFile): UploadKind {
  if (file.kind === "text") {
    return "text";
  }
  return file.kind === "pdf" ? "pdf" : "image";
}

// Why: a fresh request is built from the bytes this app already checked. The browser's own
// stream is never passed on, so what the backend receives is exactly what was validated.
export function buildBackendRequest(
  file: AcceptedFile,
  fileName: string,
  bytes: Uint8Array<ArrayBuffer>,
): BackendRequest {
  const kind = uploadKind(file);
  if (file.kind === "text") {
    return {
      path: "/ingest",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_path: fileName, text: file.text }),
        timeoutMs: BACKEND_TIMEOUT_MS.text,
      },
    };
  }
  const form = new FormData();
  const binaryKind: BinaryKind = file.kind;
  form.append("file", new Blob([bytes], { type: MIME_TYPES[binaryKind] }), fileName);
  return {
    path: kind === "pdf" ? "/ingest/pdf" : "/ingest/image",
    // Why: no Content-Type header here. fetch writes it with the multipart boundary, and a
    // hand written one would have no boundary.
    init: { method: "POST", body: form, timeoutMs: BACKEND_TIMEOUT_MS[kind] },
  };
}

// Why: each answer is checked before the browser is told it worked, like every other backend
// answer in this app.
const textSchema = z.object({
  document_id: z.guid(),
  chunk_count: z.number().int().nonnegative(),
  deduplicated: z.boolean(),
});
const imageSchema = z.object({
  document_id: z.guid(),
  modality: z.string(),
  deduplicated: z.boolean(),
});
const pdfSchema = z.object({
  document_id: z.guid(),
  page_count: z.number().int().nonnegative(),
  deduplicated: z.boolean(),
  skipped_pages: z.array(z.number().int()),
});

export type BackendOutcome =
  { ok: true; body: UploadSuccess } | { ok: false; status: number; error: UploadError };

const MAX_DETAIL_CHARS = 300;

function fail(status: number, error: UploadError): BackendOutcome {
  return { ok: false, status, error };
}

function parseSuccess(kind: UploadKind, body: unknown): UploadSuccess | null {
  if (kind === "text") {
    const parsed = textSchema.safeParse(body);
    return parsed.success
      ? {
          status: "ok",
          kind,
          documentId: parsed.data.document_id,
          deduplicated: parsed.data.deduplicated,
          chunkCount: parsed.data.chunk_count,
        }
      : null;
  }
  if (kind === "image") {
    const parsed = imageSchema.safeParse(body);
    return parsed.success
      ? {
          status: "ok",
          kind,
          documentId: parsed.data.document_id,
          deduplicated: parsed.data.deduplicated,
          modality: parsed.data.modality,
        }
      : null;
  }
  const parsed = pdfSchema.safeParse(body);
  return parsed.success
    ? {
        status: "ok",
        kind,
        documentId: parsed.data.document_id,
        deduplicated: parsed.data.deduplicated,
        pageCount: parsed.data.page_count,
        skippedPages: parsed.data.skipped_pages,
      }
    : null;
}

// Why: FastAPI's own validation errors send "detail" as a list of objects, and an unhandled
// error can send anything. Only a plain string counts, and only for the four statuses where
// the backend writes its own refusal text (400, 413, 415, 422).
function plainDetail(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("detail" in body)) {
    return null;
  }
  const { detail } = body;
  if (typeof detail !== "string" || detail.trim() === "") {
    return null;
  }
  return detail.trim().slice(0, MAX_DETAIL_CHARS);
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim() ?? "";
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  return Math.max(1, Number(value));
}

export async function readBackendResponse(
  kind: UploadKind,
  response: Response,
): Promise<BackendOutcome> {
  if (response.ok) {
    const success = parseSuccess(kind, await response.json().catch(() => null));
    return success
      ? { ok: true, body: success }
      : fail(
          502,
          uploadError("unavailable", {
            message: "The document service sent an unexpected answer.",
          }),
        );
  }

  const status = response.status;
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    const message = plainDetail(await response.json().catch(() => null));
    const code = status === 413 ? "too_large" : status === 415 ? "unsupported_type" : "rejected";
    return fail(status, uploadError(code, message === null ? {} : { message }));
  }

  // Why: nothing in the body of any other status is shown, but it is read or cancelled so
  // the connection is not left busy.
  await response.body?.cancel();
  if (status === 503) {
    const seconds = retryAfterSeconds(response);
    return fail(
      503,
      uploadError("busy", {
        ...(seconds === undefined
          ? {}
          : {
              message: `The embedding service is busy. Try again in ${seconds} seconds.`,
              retryAfterSeconds: seconds,
            }),
      }),
    );
  }
  if (status === 401) {
    return fail(401, uploadError("signed_out"));
  }
  if (status === 403) {
    return fail(403, uploadError("forbidden"));
  }
  return fail(502, uploadError("unavailable"));
}
