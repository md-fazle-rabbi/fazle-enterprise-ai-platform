import * as z from "zod";
import type { BackendInit } from "@/lib/backend";
import type { ChatResult } from "@/lib/chat/events";

export type SaveExchangeInput = {
  conversationId: string | null;
  question: string;
  result: ChatResult;
};

// Why: a backend call already tied to one signed in user. Production re-reads the session
// before every call; tests pass a fake.
export type BackendCall = (path: string, init?: BackendInit) => Promise<Response>;

const createdSchema = z.object({ id: z.guid() });

async function createConversation(call: BackendCall): Promise<string | null> {
  const response = await call("/conversations", { method: "POST" });
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const parsed = createdSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.id : null;
}

async function saveInto(
  call: BackendCall,
  conversationId: string,
  input: SaveExchangeInput,
): Promise<"saved" | "missing" | "failed"> {
  const response = await call(`/conversations/${conversationId}/exchanges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: input.question, result: input.result }),
  });
  await response.body?.cancel();
  if (response.ok) {
    return "saved";
  }
  return response.status === 404 ? "missing" : "failed";
}

// Returns the id of the conversation the exchange now lives in, or null if it was not saved.
export async function saveExchange(
  call: BackendCall,
  input: SaveExchangeInput,
): Promise<string | null> {
  if (input.conversationId !== null) {
    const outcome = await saveInto(call, input.conversationId, input);
    if (outcome === "saved") {
      return input.conversationId;
    }
    if (outcome === "failed") {
      return null;
    }
    // Why: "missing" means the conversation was deleted elsewhere (another tab). Carry on
    // in a new one rather than losing the exchange.
  }

  const createdId = await createConversation(call);
  if (createdId === null) {
    return null;
  }
  if ((await saveInto(call, createdId, input)) === "saved") {
    return createdId;
  }
  // Why: do not leave an empty "New chat" behind when the save that justified creating it
  // failed. Best effort, the failure to clean up is not worth reporting.
  try {
    const cleanup = await call(`/conversations/${createdId}`, { method: "DELETE" });
    await cleanup.body?.cancel();
  } catch {
    // ignored on purpose
  }
  return null;
}
