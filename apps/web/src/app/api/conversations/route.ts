import { handleListConversations } from "@/lib/conversations/handler";
import { getConversationsHandlerDeps } from "@/lib/conversations/server";

export async function GET() {
  try {
    return await handleListConversations(await getConversationsHandlerDeps());
  } catch (error) {
    console.error(
      "Conversations route failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json({ message: "Something went wrong" }, { status: 500 });
  }
}
