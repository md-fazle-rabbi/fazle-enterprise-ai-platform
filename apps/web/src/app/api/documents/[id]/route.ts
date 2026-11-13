import type { NextRequest } from "next/server";
import { handleDeleteDocument } from "@/lib/document-delete/handler";
import { getDocumentDeleteHandlerDeps } from "@/lib/document-delete/server";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  const { id } = await context.params;
  try {
    return await handleDeleteDocument(request, await getDocumentDeleteHandlerDeps(), id);
  } catch (error) {
    // Why: only the message is logged, never an object that could carry tokens.
    console.error(
      "Document delete route failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json({ message: "Something went wrong" }, { status: 500 });
  }
}
