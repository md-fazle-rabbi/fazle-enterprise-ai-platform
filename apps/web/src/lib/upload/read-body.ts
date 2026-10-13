// Why: the route reads an upload from a stream it does not trust. A client can declare a small
// Content-Length and send more, or send chunked with no length at all. Counting the bytes
// as they arrive is the only limit that holds in both cases, and it stops reading at the limit
// instead of buffering a whole oversized body first.
export class BodyTooLargeError extends Error {}

// Why: only plain digits count. Anything else is ignored here, and the byte counter below is
// still enforced, so a made up header cannot switch the limit off. A huge number becomes
// a huge value, which the caller refuses.
export function declaredLength(header: string | null): number | null {
  const value = header?.trim() ?? "";
  return /^\d+$/.test(value) ? Number(value) : null;
}

export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (body === null) {
    return new Uint8Array(0);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      // Why: tells the sender to stop. A failed cancel changes nothing, the error below is
      // what matters.
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(`The body is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  // Why: one allocation of the exact size, so the many small chunks are not kept as well.
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
