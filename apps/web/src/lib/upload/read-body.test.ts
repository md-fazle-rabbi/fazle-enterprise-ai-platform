// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { BodyTooLargeError, declaredLength, readBoundedBody } from "./read-body";

function streamOf(
  chunks: Uint8Array[],
  hooks: { onPull?: () => void; onCancel?: () => void } = {},
) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      hooks.onPull?.();
      const chunk = chunks[index];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      index += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      hooks.onCancel?.();
    },
  });
}

describe("readBoundedBody", () => {
  it("joins the chunks in order", async () => {
    const body = streamOf([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])]);
    expect(Array.from(await readBoundedBody(body, 100))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("accepts a body of exactly the limit", async () => {
    const bytes = await readBoundedBody(streamOf([new Uint8Array(10)]), 10);
    expect(bytes.byteLength).toBe(10);
  });

  it("refuses one byte over the limit", async () => {
    await expect(readBoundedBody(streamOf([new Uint8Array(11)]), 10)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });

  it("stops reading and cancels the stream once the limit is passed", async () => {
    const onPull = vi.fn();
    const onCancel = vi.fn();
    // Why: 1,000 small chunks against a 100 byte limit. A reader that kept going would pull
    // them all before it noticed.
    const chunks = Array.from({ length: 1_000 }, () => new Uint8Array(10));
    await expect(
      readBoundedBody(streamOf(chunks, { onPull, onCancel }), 100),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onPull.mock.calls.length).toBeLessThan(50);
  });

  it("treats a missing body as empty", async () => {
    expect((await readBoundedBody(null, 10)).byteLength).toBe(0);
  });
});

describe("declaredLength", () => {
  it.each([
    ["123", 123],
    [" 42 ", 42],
    ["0", 0],
    ["99999999999999999999", 1e20],
  ])("reads %j as %d", (header, expected) => {
    expect(declaredLength(header)).toBe(expected);
  });

  it.each([[null], [""], ["abc"], ["-5"], ["1e3"], ["12 34"], ["0x10"]])(
    "ignores %j, so only the byte counter applies",
    (header) => {
      expect(declaredLength(header)).toBeNull();
    },
  );
});
