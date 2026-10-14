import * as z from "zod";
import { MAX_PDF_BYTES, MIB } from "./limits";
import { UPLOAD_ERROR_CODES, uploadError, type UploadError, type UploadSuccess } from "./result";

export type UploadOutcome = { ok: true; result: UploadSuccess } | { ok: false; error: UploadError };

// Why: the answers of /api/documents are checked here too, like every other answer in this
// app. The route is ours, but a proxy or an error page in between could send anything.
const successBase = {
  status: z.literal("ok"),
  documentId: z.string(),
  deduplicated: z.boolean(),
};
const successSchema = z.discriminatedUnion("kind", [
  z.object({ ...successBase, kind: z.literal("text"), chunkCount: z.number().int() }),
  z.object({ ...successBase, kind: z.literal("image"), modality: z.string() }),
  z.object({
    ...successBase,
    kind: z.literal("pdf"),
    pageCount: z.number().int(),
    skippedPages: z.array(z.number().int()),
  }),
]);

const errorSchema = z.object({
  code: z.enum(UPLOAD_ERROR_CODES),
  message: z.string().min(1),
  retryAfterSeconds: z.number().optional(),
});

function fail(error: UploadError): UploadOutcome {
  return { ok: false, error };
}

export async function uploadDocument(file: File): Promise<UploadOutcome> {
  // Why: the only rule checked in the browser, and only to spare a pointless 10 MiB upload.
  // The type, the content and every other limit are decided on the server, which is the one
  // place that cannot be skipped. Checking the type here as well would be a second copy to
  // keep in step.
  if (file.size > MAX_PDF_BYTES) {
    return fail(
      uploadError("too_large", {
        message: `The file is too large. The biggest file allowed is ${MAX_PDF_BYTES / MIB} MiB.`,
      }),
    );
  }

  const form = new FormData();
  form.append("file", file);

  let response: Response;
  try {
    // Why: no Content-Type header. fetch writes it with the multipart boundary. The browser
    // adds the Origin header itself, which the route checks.
    response = await fetch("/api/documents", { method: "POST", body: form });
  } catch {
    return fail(
      uploadError("unavailable", {
        message: "The upload could not be sent. Check your connection and try again.",
      }),
    );
  }

  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = successSchema.safeParse(body);
    return parsed.success
      ? { ok: true, result: parsed.data }
      : fail(uploadError("unavailable", { message: "The server sent an unexpected answer." }));
  }

  const parsed = errorSchema.safeParse(body);
  if (!parsed.success) {
    return fail(uploadError("unavailable", { message: "The upload failed. Try again later." }));
  }
  const { code, message, retryAfterSeconds } = parsed.data;
  return fail(
    uploadError(code, {
      message,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    }),
  );
}
