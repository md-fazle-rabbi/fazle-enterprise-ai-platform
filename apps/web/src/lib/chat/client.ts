import { createSseParser } from "@/lib/sse";
import { parseChatEvent, type ChatEvent } from "./events";

// Why: reads the already-translated events /api/chat sends (see handler.ts on the server).
// There is no upstream status or thrown error to map here, only bytes to turn into events.
export async function* readChatEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      for (const message of parser.feed(decoder.decode(value, { stream: true }))) {
        const event = parseChatEvent(message);
        if (event) {
          yield event;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
