import { createSseParser } from "@/lib/sse";
import { chatError, parseChatEvent, type ChatEvent } from "./events";

// Why: reads the already-translated events /api/chat sends (see handler.ts on the server).
// There is no upstream status or thrown error to map here, only bytes to turn into events.
// Every stream this yields ends with a result or an error, so the UI is never left waiting.
export async function* readChatEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        // Why: the connection closed before a result or an error arrived (a proxy cut it,
        // the server restarted). Same code the server uses for this case in stream.ts.
        yield { type: "error", data: chatError("unavailable") };
        return;
      }
      for (const message of parser.feed(decoder.decode(value, { stream: true }))) {
        const event = parseChatEvent(message);
        if (event) {
          yield event;
          // A result or an error is the last thing the server sends.
          if (event.type !== "stage") {
            return;
          }
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
