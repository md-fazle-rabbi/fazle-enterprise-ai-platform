import type { NextRequest } from "next/server";
import { chatError } from "@/lib/chat/events";
import { handleChat } from "@/lib/chat/handler";
import { getChatHandlerDeps } from "@/lib/chat/server";

export async function POST(request: NextRequest) {
  try {
    return await handleChat(request, getChatHandlerDeps());
  } catch (error) {
    // Why: only the message is logged, never an object that could carry tokens.
    console.error("Chat route failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json(chatError("internal"), { status: 500 });
  }
}
