export type SseMessage = {
  event: string;
  data: string;
};

// Why: a stream that never sends a line break, or one enormous event, must not be able to
// grow memory without bound.
const MAX_PENDING_CHARS = 1_000_000;
const LINE_END = /\r\n|\n|\r/;

// A small parser for Server-Sent Events. It accepts text in pieces of any size, because the
// network can cut a stream in the middle of a line, and returns each finished event.
export function createSseParser() {
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];
  let dataSize = 0;

  function dispatch(): SseMessage | null {
    const message =
      dataLines.length > 0 ? { event: eventName || "message", data: dataLines.join("\n") } : null;
    eventName = "";
    dataLines = [];
    dataSize = 0;
    return message;
  }

  function readLine(line: string): SseMessage | null {
    if (line === "") {
      return dispatch();
    }
    if (line.startsWith(":")) {
      return null;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "event") {
      eventName = value;
    } else if (field === "data") {
      dataSize += value.length;
      if (dataSize > MAX_PENDING_CHARS) {
        throw new Error("SSE event too large");
      }
      dataLines.push(value);
    }
    return null;
  }

  return {
    feed(chunk: string): SseMessage[] {
      buffer += chunk;
      const messages: SseMessage[] = [];
      for (;;) {
        const match = LINE_END.exec(buffer);
        // Why: a CR at the very end may be the first half of CRLF, so wait for more text.
        if (!match || (match[0] === "\r" && match.index === buffer.length - 1)) {
          break;
        }
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const message = readLine(line);
        if (message) {
          messages.push(message);
        }
      }
      if (buffer.length > MAX_PENDING_CHARS) {
        throw new Error("SSE frame too large");
      }
      return messages;
    },
  };
}

export function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
