// Why: the shapes the browser gets back from POST /api/documents. A code is what the upload
// form switches on, and the message is always safe to show. A message is either fixed text from
// this file, or a backend refusal that passed the checks in forward.ts. It never carries a
// stack trace, a path or anything from a file the user sent.
// Why: the list is the source of truth and the type is derived from it, so the browser side
// can check a code with z.enum(UPLOAD_ERROR_CODES) and a new code cannot be added to one and
// forgotten in the other.
export const UPLOAD_ERROR_CODES = [
  "invalid_request",
  "forbidden",
  "signed_out",
  "no_workspace",
  "rate_limited",
  "upload_in_progress",
  "too_large",
  "unsupported_type",
  "invalid_file",
  "empty_file",
  "rejected",
  "busy",
  "unavailable",
  "timeout",
  "internal",
] as const;

export type UploadErrorCode = (typeof UPLOAD_ERROR_CODES)[number];

export type UploadError = {
  code: UploadErrorCode;
  message: string;
  // Why: set for rate_limited and busy, so the form can show "try again in N seconds".
  retryAfterSeconds?: number;
};

export type UploadSuccess =
  | { status: "ok"; kind: "text"; documentId: string; deduplicated: boolean; chunkCount: number }
  | { status: "ok"; kind: "image"; documentId: string; deduplicated: boolean; modality: string }
  | {
      status: "ok";
      kind: "pdf";
      documentId: string;
      deduplicated: boolean;
      pageCount: number;
      // Why: a page with no readable content is skipped, not failed. The form shows which
      // pages, so a gap in the stored document is never a surprise.
      skippedPages: number[];
    };

const DEFAULT_MESSAGES: Record<UploadErrorCode, string> = {
  invalid_request: "The upload could not be read. Choose one file and try again.",
  forbidden: "This request was refused.",
  signed_out: "Your session ended. Sign in again.",
  no_workspace: "No workspace is selected. Choose a workspace first.",
  rate_limited: "Too many uploads. Try again in a moment.",
  upload_in_progress: "Another upload is still running. Wait for it to finish.",
  too_large: "The file is too large.",
  unsupported_type:
    "This file type is not supported. Upload a PDF, PNG, JPEG, WEBP, TXT or MD file.",
  invalid_file: "The file could not be read as text. Upload a UTF-8 .txt or .md file.",
  empty_file: "The file is empty.",
  rejected: "The file was refused.",
  busy: "The embedding service is busy. Try again in a minute.",
  unavailable: "The document service is not available right now.",
  timeout:
    "The upload took too long. The file may still be processing, so check the document list before trying again.",
  internal: "Something went wrong.",
};

export function uploadError(
  code: UploadErrorCode,
  options: { message?: string; retryAfterSeconds?: number } = {},
): UploadError {
  const error: UploadError = { code, message: options.message ?? DEFAULT_MESSAGES[code] };
  if (options.retryAfterSeconds !== undefined) {
    error.retryAfterSeconds = options.retryAfterSeconds;
  }
  return error;
}
