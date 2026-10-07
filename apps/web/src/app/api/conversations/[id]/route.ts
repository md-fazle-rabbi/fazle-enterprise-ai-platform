import type { NextRequest } from "next/server";
import { handleDeleteConversation, handleGetConversation } from "@/lib/conversations/handler";
import { getConversationsHandlerDeps } from "@/lib/conversations/server";

type Context = { params: Promise<{ id: string }> };

function failed(error: unknown): Response {
  console.error(
    "Conversations route failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  return Response.json({ message: "Something went wrong" }, { status: 500 });
}

export async function GET(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  try {
    return await handleGetConversation(await getConversationsHandlerDeps(), id);
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const { id } = await context.params;
  try {
    return await handleDeleteConversation(request, await getConversationsHandlerDeps(), id);
  } catch (error) {
    return failed(error);
  }
}
