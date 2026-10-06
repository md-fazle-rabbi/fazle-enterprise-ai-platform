import { describe, expect, it, vi } from "vitest";
import {
  createConcurrencyLimiter,
  createSlidingWindowLimiter,
  type RateLimitRedis,
} from "./limiter";
import { ACQUIRE_SLOT_SCRIPT, RELEASE_SLOT_SCRIPT, SLIDING_WINDOW_SCRIPT } from "./scripts";

function fakeRedis(reply: unknown) {
  const evalScript = vi.fn(async (_script: string, _keys: string[], _args: string[]) => reply);
  const redis: RateLimitRedis = { evalScript };
  return { redis, evalScript };
}

const windowOptions = {
  keyPrefix: "web:rl:chat:",
  limit: 20,
  windowMs: 60_000,
  newId: () => "fixed-id",
};
const slotOptions = {
  keyPrefix: "web:conc:chat:",
  max: 2,
  holderTtlMs: 150_000,
  newId: () => "holder-1",
};

describe("createSlidingWindowLimiter", () => {
  it("allows a request and reports what is left", async () => {
    const { redis } = fakeRedis([1, 3, 0]);
    const limiter = createSlidingWindowLimiter({ redis, ...windowOptions });
    await expect(limiter.consume("user-1")).resolves.toEqual({ allowed: true, remaining: 17 });
  });

  it("never reports a negative remaining count", async () => {
    const { redis } = fakeRedis([1, 25, 0]);
    const limiter = createSlidingWindowLimiter({ redis, ...windowOptions });
    await expect(limiter.consume("user-1")).resolves.toEqual({ allowed: true, remaining: 0 });
  });

  it("refuses with a retry time rounded up to whole seconds", async () => {
    const { redis } = fakeRedis([0, 20, 12_400]);
    const limiter = createSlidingWindowLimiter({ redis, ...windowOptions });
    await expect(limiter.consume("user-1")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 13,
    });
  });

  it("never tells a client to retry in zero seconds", async () => {
    const { redis } = fakeRedis([0, 20, -50]);
    const limiter = createSlidingWindowLimiter({ redis, ...windowOptions });
    await expect(limiter.consume("user-1")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it("sends the script, the per user key and the settings to Redis", async () => {
    const { redis, evalScript } = fakeRedis([1, 1, 0]);
    await createSlidingWindowLimiter({ redis, ...windowOptions }).consume("user-1");
    expect(evalScript).toHaveBeenCalledWith(
      SLIDING_WINDOW_SCRIPT,
      ["web:rl:chat:user-1"],
      ["60000", "20", "fixed-id"],
    );
  });

  it("throws on a reply it does not understand", async () => {
    const { redis } = fakeRedis("nope");
    const limiter = createSlidingWindowLimiter({ redis, ...windowOptions });
    await expect(limiter.consume("user-1")).rejects.toThrow(/Unexpected reply/);
  });

  it.each([
    ["too few items", [1, 3]],
    ["too many items", [1, 3, 0, 9]],
    ["a non-number item", [1, "3", 0]],
    ["an empty array", []],
    ["null", null],
  ])("throws when the reply has %s", async (_name, reply) => {
    const { redis } = fakeRedis(reply);
    const limiter = createSlidingWindowLimiter({ redis, ...windowOptions });
    await expect(limiter.consume("user-1")).rejects.toThrow(/Unexpected reply/);
  });
});

describe("createConcurrencyLimiter", () => {
  it("hands out a slot when Redis says there is room", async () => {
    const { redis, evalScript } = fakeRedis(1);
    const slot = await createConcurrencyLimiter({ redis, ...slotOptions }).acquire("user-1");
    expect(slot).not.toBeNull();
    expect(evalScript).toHaveBeenCalledWith(
      ACQUIRE_SLOT_SCRIPT,
      ["web:conc:chat:user-1"],
      ["2", "150000", "holder-1"],
    );
  });

  it("returns null when every slot is taken", async () => {
    const { redis } = fakeRedis(0);
    await expect(
      createConcurrencyLimiter({ redis, ...slotOptions }).acquire("user-1"),
    ).resolves.toBeNull();
  });

  it("releases with the same key and holder id", async () => {
    const { redis, evalScript } = fakeRedis(1);
    const slot = await createConcurrencyLimiter({ redis, ...slotOptions }).acquire("user-1");
    await slot?.release();
    expect(evalScript).toHaveBeenLastCalledWith(
      RELEASE_SLOT_SCRIPT,
      ["web:conc:chat:user-1"],
      ["holder-1"],
    );
  });

  it("throws on a reply it does not understand", async () => {
    const { redis } = fakeRedis([1]);
    await expect(
      createConcurrencyLimiter({ redis, ...slotOptions }).acquire("user-1"),
    ).rejects.toThrow(/Unexpected reply/);
  });

  it("throws when the flag is a string instead of a number", async () => {
    const { redis } = fakeRedis("1");
    await expect(
      createConcurrencyLimiter({ redis, ...slotOptions }).acquire("user-1"),
    ).rejects.toThrow(/Unexpected reply/);
  });
});
