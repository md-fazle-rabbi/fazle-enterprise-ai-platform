import type { NextRequest } from "next/server";
import { handleUpload } from "@/lib/upload/handler";
import { uploadError } from "@/lib/upload/result";
import { getUploadHandlerDeps } from "@/lib/upload/server";

export async function POST(request: NextRequest) {
  try {
    return await handleUpload(request, getUploadHandlerDeps());
  } catch (error) {
    // Why: only the message is logged, never an object that could carry tokens.
    console.error("Upload route failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json(uploadError("internal"), { status: 500 });
  }
}
