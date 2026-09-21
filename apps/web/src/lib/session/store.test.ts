// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { makeSession } from "./fixtures";
import { RedisSessionStore, sessionKeyFor, type RedisLike } from "./store";

class FakeRedis implements RedisLike {
  readonly entries = new Map<string, { value: string; ttl: number }>();

  async get(key: string) {
    return this.entries.get(key)?.value ?? null;
  }

  async setEx(key: string, seconds: number, value: string) {
    this.entries.set(key, { value, ttl: seconds });
  }

  async setIfExistsKeepTtl(key: string, value: string) {
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }
    entry.value = value;
    return true;
  }

  async del(key: string) {
    this.entries.delete(key);
  }
}

const TTL_SECONDS = 3_600;
let redis: FakeRedis;
let store: RedisSessionStore;

beforeEach(() => {
  redis = new FakeRedis();
  store = new RedisSessionStore(redis, TTL_SECONDS);
});

describe("RedisSessionStore", () => {
  it("returns an unguessable id and reads the session back", async () => {
    const data = makeSession();
    const sid = await store.create(data);
    expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(store.get(sid)).resolves.toEqual(data);
  });

  it("gives every session a different id", async () => {
    const first = await store.create(makeSession());
    const second = await store.create(makeSession());
    expect(first).not.toBe(second);
  });

  it("never uses the raw session id as a Redis key", async () => {
    const sid = await store.create(makeSession());
    const keys = [...redis.entries.keys()];
    expect(keys).toEqual([sessionKeyFor(sid)]);
    expect(keys[0]).toMatch(/^web:session:[0-9a-f]{64}$/);
    expect(keys[0]).not.toContain(sid);
  });

  it("stores the session with the configured lifetime", async () => {
    const sid = await store.create(makeSession());
    expect(redis.entries.get(sessionKeyFor(sid))?.ttl).toBe(TTL_SECONDS);
  });

  it("returns null for an unknown session", async () => {
    await expect(store.get("does-not-exist")).resolves.toBeNull();
  });

  it.each([
    ["broken JSON", "{not json"],
    ["a missing field", JSON.stringify({ accessToken: "only-this" })],
  ])("drops a session with %s", async (_label, payload) => {
    const sid = "some-session-id";
    await redis.setEx(sessionKeyFor(sid), TTL_SECONDS, payload);
    await expect(store.get(sid)).resolves.toBeNull();
    expect(redis.entries.has(sessionKeyFor(sid))).toBe(false);
  });

  it("updates the data and keeps the remaining lifetime", async () => {
    const sid = await store.create(makeSession());
    const updated = makeSession({ accessToken: "refreshed-access-token" });
    await expect(store.update(sid, updated)).resolves.toBe(true);
    await expect(store.get(sid)).resolves.toEqual(updated);
    expect(redis.entries.get(sessionKeyFor(sid))?.ttl).toBe(TTL_SECONDS);
  });

  it("refuses to update a session that no longer exists", async () => {
    await expect(store.update("gone", makeSession())).resolves.toBe(false);
    expect(redis.entries.size).toBe(0);
  });

  it("removes a destroyed session", async () => {
    const sid = await store.create(makeSession());
    await store.destroy(sid);
    await expect(store.get(sid)).resolves.toBeNull();
  });
});
