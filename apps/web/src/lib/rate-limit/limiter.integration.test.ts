// @vitest-environment node
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRateLimitRedis } from "@/lib/redis";
import { createConcurrencyLimiter, createSlidingWindowLimiter } from "./limiter";

// Why: runs only against Redis database 15, like the session store tests. Start it with:
// REDIS_TEST_URL=redis://localhost:6379/15 npx vitest run src/lib/rate-limit/limiter.integration.test.ts
const redisUrl = process.env.REDIS_TEST_URL;
const RUN = randomUUID();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!redisUrl?.endsWith("/15"))("Rate limiters on a real Redis", () => {
  const client = createClient({ url: redisUrl });
  const redis = createRateLimitRedis(client);
  const windowLimiter = (limit: number, windowMs: number) =>
    createSlidingWindowLimiter({ redis, keyPrefix: `test:rl:${RUN}:`, limit, windowMs });
  const slotLimiter = (max: number, holderTtlMs: number) =>
    createConcurrencyLimiter({ redis, keyPrefix: `test:conc:${RUN}:`, max, holderTtlMs });

  beforeAll(async () => {
    client.on("error", () => undefined);
    await client.connect();
  });

  afterAll(async () => {
    const keys = await client.keys(`test:*:${RUN}:*`);
    if (keys.length > 0) {
      await client.del(keys);
    }
    await client.close();
  });

  it("allows requests up to the limit, then blocks", async () => {
    const limiter = windowLimiter(3, 60_000);
    expect(await limiter.consume("a")).toEqual({ allowed: true, remaining: 2 });
    expect(await limiter.consume("a")).toEqual({ allowed: true, remaining: 1 });
    expect(await limiter.consume("a")).toEqual({ allowed: true, remaining: 0 });
    const blocked = await limiter.consume("a");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("tracks each subject separately", async () => {
    const limiter = windowLimiter(1, 60_000);
    expect((await limiter.consume("b1")).allowed).toBe(true);
    expect((await limiter.consume("b1")).allowed).toBe(false);
    expect((await limiter.consume("b2")).allowed).toBe(true);
  });

  it("does not record a blocked request, so it cannot extend the block", async () => {
    const limiter = windowLimiter(1, 60_000);
    await limiter.consume("c");
    await limiter.consume("c");
    await limiter.consume("c");
    await expect(client.zCard(`test:rl:${RUN}:c`)).resolves.toBe(1);
  });

  it("lets a request through again once the window has passed", async () => {
    const limiter = windowLimiter(1, 300);
    expect((await limiter.consume("d")).allowed).toBe(true);
    expect((await limiter.consume("d")).allowed).toBe(false);
    await sleep(350);
    expect((await limiter.consume("d")).allowed).toBe(true);
  });

  it("leaves no key behind once the window has passed", async () => {
    await windowLimiter(1, 200).consume("e");
    await sleep(300);
    await expect(client.exists(`test:rl:${RUN}:e`)).resolves.toBe(0);
  });

  it("refuses a stream slot beyond the maximum, and frees one on release", async () => {
    const limiter = slotLimiter(2, 60_000);
    const first = await limiter.acquire("f");
    expect(await limiter.acquire("f")).not.toBeNull();
    expect(await limiter.acquire("f")).toBeNull();
    await first?.release();
    expect(await limiter.acquire("f")).not.toBeNull();
  });

  it("does not count a holder whose time is up", async () => {
    const limiter = slotLimiter(1, 200);
    expect(await limiter.acquire("g")).not.toBeNull();
    expect(await limiter.acquire("g")).toBeNull();
    await sleep(250);
    expect(await limiter.acquire("g")).not.toBeNull();
  });

  it("releasing twice never frees someone else's slot", async () => {
    const limiter = slotLimiter(2, 60_000);
    const first = await limiter.acquire("h");
    await limiter.acquire("h");
    await first?.release();
    await first?.release();
    expect(await limiter.acquire("h")).not.toBeNull();
    expect(await limiter.acquire("h")).toBeNull();
  });
});
