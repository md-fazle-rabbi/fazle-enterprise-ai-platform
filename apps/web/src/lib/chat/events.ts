import * as z from "zod";

// Why: this file has no server code, so the browser can use the same types and schemas.
export const STAGES = [
  "cache_lookup",
  "retrieval",
  "grading",
  "generation",
  "output_checks",
] as const;

export const stageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof stageSchema>;

const citationSchema = z.object({
  chunk_id: z.guid(),
  document_id: z.guid(),
  heading_path: z.array(z.string()),
  text: z.string(),
});
export type Citation = z.infer<typeof citationSchema>;

// The shape of the backend's QueryResponse (rag_engine/routers/query.py).
export const chatResultSchema = z.object({
  answer: z.string(),
  citations: z.array(citationSchema),
  retrieved_context: z.array(citationSchema),
  retrieved_but_uncited_count: z.number().int().nonnegative(),
  flagged: z.boolean(),
  flag_reasons: z.array(z.string()),
});
export type ChatResult = z.infer<typeof chatResultSchema>;

export const chatErrorCodeSchema = z.enum([
  "blocked",
  "quota",
  "signed_out",
  "no_tenant",
  "unavailable",
  "invalid_request",
  "internal",
]);
export type ChatErrorCode = z.infer<typeof chatErrorCodeSchema>;

// Why: every error the user can see has a fixed sentence. Nothing the backend wrote is passed on.
export const CHAT_ERROR_MESSAGES: Record<ChatErrorCode, string> = {
  blocked: "This question was blocked by the security filter.",
  quota: "The daily usage limit for this workspace has been reached.",
  signed_out: "Your session has ended. Please sign in again.",
  no_tenant: "This account has no workspace, so it cannot ask questions.",
  unavailable: "The answer service is not available right now. Please try again in a moment.",
  invalid_request: "The question could not be processed.",
  internal: "Something went wrong while answering.",
};

export type ChatError = { code: ChatErrorCode; message: string };

export function chatError(code: ChatErrorCode): ChatError {
  return { code, message: CHAT_ERROR_MESSAGES[code] };
}

export type ChatEvent =
  | { type: "stage"; data: { stage: Stage } }
  | { type: "result"; data: ChatResult }
  | { type: "error"; data: ChatError };
