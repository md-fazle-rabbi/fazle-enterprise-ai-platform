// @vitest-environment node
import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedisLike } from "@/lib/redis";
import { makeSession } from "./fixtures";
import { RedisSessionStore, sessionKeyFor } from "./store";

// Why: runs only against Redis database 15, so it can never touch the backend's data in
// database 0 or the web sessions in database 1. Start it with:
// REDIS_TEST_URL=redis://localhost:6379/15 npx vitest run src/lib/session/store.integration.test.ts
const redisUrl = process.env.REDIS_TEST_URL;

describe.skipIf(!redisUrl?.endsWith("/15"))("RedisSessionStore on a real Redis", () => {
  const client = createClient({ url: redisUrl });
  const store = new RedisSessionStore(createRedisLike(client), 60);
  const created: string[] = [];

  async function newSession(data = makeSession()) {
    const sid = await store.create(data);
    created.push(sid);
    return sid;
  }

  beforeAll(async () => {
    client.on("error", () => undefined);
    await client.connect();
  });

  afterAll(async () => {
    await Promise.all(created.map((sid) => store.destroy(sid)));
    await client.close();
  });

  it("stores a hashed key and reads the session back", async () => {
    const data = makeSession();
    const sid = await newSession(data);
    const keys = await client.keys("web:session:*");
    expect(keys).toContain(sessionKeyFor(sid));
    expect(keys.every((key) => !key.includes(sid))).toBe(true);
    await expect(store.get(sid)).resolves.toEqual(data);
  });

  it("keeps the remaining lifetime when a session is updated", async () => {
    const sid = await newSession();
    await expect(store.update(sid, makeSession({ accessToken: "new" }))).resolves.toBe(true);
    const ttl = await client.ttl(sessionKeyFor(sid));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it("does not bring back a destroyed session", async () => {
    const sid = await newSession();
    await store.destroy(sid);
    await expect(store.update(sid, makeSession())).resolves.toBe(false);
    await expect(client.exists(sessionKeyFor(sid))).resolves.toBe(0);
  });

  it("drops unreadable data instead of trusting it", async () => {
    const sid = "corrupted-session";
    await client.setEx(sessionKeyFor(sid), 60, "{not json");
    await expect(store.get(sid)).resolves.toBeNull();
    await expect(client.exists(sessionKeyFor(sid))).resolves.toBe(0);
  });
});
