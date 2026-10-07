import { createSseParser } from "@/lib/sse";
import { chatError, parseChatEvent, type ChatEvent } from "./events";

// Why: reads the already-translated events /api/chat sends (see handler.ts on the server).
// There is no upstream status or thrown error to map here, only bytes to turn into events.
// The server sends stage events, then a result or an error. After a result it may send one
// history event (the saved conversation id, or null). An error or a history event is always
// last. If the stream closes before any result or error, the UI gets an "unavailable" error,
// so it is never left waiting.
export async function* readChatEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  let gotResult = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        // Why: a clean close after a result is normal (the server may send no history
        // event). Only a close with no result is a failure.
        if (!gotResult) {
          yield { type: "error", data: chatError("unavailable") };
        }
        return;
      }
      for (const message of parser.feed(decoder.decode(value, { stream: true }))) {
        const event = parseChatEvent(message);
        if (event) {
          yield event;
          if (event.type === "result") {
            gotResult = true;
          } else if (event.type === "error" || event.type === "history") {
            return;
          }
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
