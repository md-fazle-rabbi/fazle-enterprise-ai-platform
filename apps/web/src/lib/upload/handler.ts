import type { NextRequest } from "next/server";
import { NoTenantError, NotSignedInError } from "@/lib/auth/errors";
import type { Session } from "@/lib/auth/session";
import type { BackendInit } from "@/lib/backend";
import type { RateDecision, StreamSlot } from "@/lib/rate-limit/limiter";
import {
  buildBackendRequest,
  readBackendResponse,
  uploadKind,
  type AcceptedFile,
  type BackendOutcome,
} from "./forward";
import { MAX_REQUEST_BYTES, MAX_PDF_BYTES, MIB } from "./limits";
import { BodyTooLargeError, declaredLength, readBoundedBody } from "./read-body";
import { uploadError, type UploadErrorCode } from "./result";
import { classifyUpload, sanitizeFileName } from "./sniff";

type UploadLimits = {
  consumeRequest: (userId: string) => Promise<RateDecision>;
  acquireUpload: (userId: string) => Promise<StreamSlot | null>;
};

// Why: everything the handler needs comes in through this object, so the rules can be tested
// without Redis, Keycloak or a backend. This is the same pattern as the chat handler.
export type UploadHandlerDeps = {
  appUrl: string;
  getSession: () => Promise<Session | null>;
  limits: UploadLimits;
  forward: (session: Session, path: string, init: BackendInit) => Promise<Response>;
};

const NO_STORE = { "Cache-Control": "no-store" };

function refuse(
  status: number,
  code: UploadErrorCode,
  options: { message?: string; retryAfterSeconds?: number } = {},
): Response {
  const headers: Record<string, string> = { ...NO_STORE };
  if (options.retryAfterSeconds !== undefined) {
    headers["Retry-After"] = String(options.retryAfterSeconds);
  }
  return Response.json(uploadError(code, options), { status, headers });
}

const BODY_TOO_LARGE = `The upload is too large. The biggest file allowed is ${MAX_PDF_BYTES / MIB} MiB.`;

function tooLarge(): Response {
  return refuse(413, "too_large", { message: BODY_TOO_LARGE });
}

async function parseFile(
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<File | null> {
  // Why: the form is parsed from bytes this app already counted. request.formData() would
  // read the stream itself, and how much memory it uses before it finishes is not something
  // the Next.js docs promise anything about.
  const form = await new Response(bytes, { headers: { "content-type": contentType } })
    .formData()
    .catch(() => null);
  const files = form?.getAll("file") ?? [];
  const [file] = files;
  return files.length === 1 && file instanceof File ? file : null;
}

function refuseUnaccepted(result: Exclude<ReturnType<typeof classifyUpload>, { ok: true }>) {
  switch (result.reason) {
    case "empty":
      return refuse(400, "empty_file");
    case "unsupported_type":
      return refuse(415, "unsupported_type");
    case "invalid_text":
      return refuse(422, "invalid_file");
    case "too_large":
      return refuse(413, "too_large", {
        message: `The file is too large. The limit is ${result.limit}.`,
      });
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function sendToBackend(
  deps: UploadHandlerDeps,
  session: Session,
  file: AcceptedFile,
  fileName: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Response> {
  const request = buildBackendRequest(file, fileName, bytes);
  let outcome: BackendOutcome;
  try {
    const response = await deps.forward(session, request.path, request.init);
    outcome = await readBackendResponse(uploadKind(file), response);
  } catch (error) {
    if (error instanceof NotSignedInError) {
      return refuse(401, "signed_out");
    }
    if (error instanceof NoTenantError) {
      return refuse(409, "no_workspace");
    }
    // Why: only the message is logged, never the error object, which could carry tokens.
    console.error(
      "Upload to the backend failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return isTimeout(error) ? refuse(504, "timeout") : refuse(502, "unavailable");
  }
  if (!outcome.ok) {
    return refuse(outcome.status, outcome.error.code, {
      message: outcome.error.message,
      ...(outcome.error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: outcome.error.retryAfterSeconds }),
    });
  }
  return Response.json(outcome.body, { status: 201, headers: NO_STORE });
}

export async function handleUpload(
  request: NextRequest,
  deps: UploadHandlerDeps,
): Promise<Response> {
  // Why: a request from another site must not be able to upload into this user's workspace.
  // The session cookie is SameSite Lax, and the Origin has to be this app as well.
  if (request.headers.get("origin") !== deps.appUrl) {
    return refuse(403, "forbidden");
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return refuse(415, "invalid_request");
  }

  const session = await deps.getSession();
  if (!session) {
    return refuse(401, "signed_out");
  }

  // Why: counted BEFORE the body is read, so a stream of bad uploads uses up the limit too.
  // Only requests that passed the origin and session checks are counted.
  const userId = session.data.user.id;
  const decision = await deps.limits.consumeRequest(userId);
  if (!decision.allowed) {
    return refuse(429, "rate_limited", {
      message: `Too many uploads. Try again in ${decision.retryAfterSeconds} seconds.`,
      retryAfterSeconds: decision.retryAfterSeconds,
    });
  }

  // Why: a declared size over the limit is refused without reading a byte. The header can
  // lie, which is why the reader below counts bytes as well.
  const declared = declaredLength(request.headers.get("content-length"));
  if (declared !== null && declared > MAX_REQUEST_BYTES) {
    await request.body?.cancel().catch(() => undefined);
    return tooLarge();
  }

  // Why: taken before the body is read, because holding the body is what costs memory. One
  // upload at a time per user also keeps a person from queueing several 3 minute PDF calls
  // behind the free tier embedding quota.
  const slot = await deps.limits.acquireUpload(userId);
  if (!slot) {
    return refuse(429, "upload_in_progress");
  }
  try {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await readBoundedBody(request.body, MAX_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return tooLarge();
      }
      // Why: the browser went away in the middle of the upload. There is no one to answer.
      return refuse(400, "invalid_request");
    }

    const file = await parseFile(bytes, contentType);
    if (file === null) {
      return refuse(400, "invalid_request");
    }
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const fileName = sanitizeFileName(file.name);
    const classified = classifyUpload(fileName, fileBytes);
    if (!classified.ok) {
      return refuseUnaccepted(classified);
    }
    return await sendToBackend(deps, session, classified, fileName, fileBytes);
  } finally {
    await slot.release().catch(() => undefined);
  }
}
