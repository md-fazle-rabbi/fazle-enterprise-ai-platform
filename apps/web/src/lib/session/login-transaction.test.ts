// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { FakeRedis } from "./fake-redis";
import { loginKeyFor, LoginTransactionStore, type LoginTransaction } from "./login-transaction";

const TTL_SECONDS = 600;

const transaction: LoginTransaction = {
  state: "state-value",
  nonce: "nonce-value",
  codeVerifier: "verifier-value",
  returnTo: "/chat",
};

let redis: FakeRedis;
let store: LoginTransactionStore;

beforeEach(() => {
  redis = new FakeRedis();
  store = new LoginTransactionStore(redis, TTL_SECONDS);
});

describe("LoginTransactionStore", () => {
  it("returns an unguessable id and hands the transaction back", async () => {
    const txid = await store.begin(transaction);
    expect(txid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(store.consume(txid)).resolves.toEqual(transaction);
  });

  it("can be consumed only once", async () => {
    const txid = await store.begin(transaction);
    await store.consume(txid);
    await expect(store.consume(txid)).resolves.toBeNull();
  });

  it("never uses the raw id as a Redis key", async () => {
    const txid = await store.begin(transaction);
    const keys = [...redis.entries.keys()];
    expect(keys).toEqual([loginKeyFor(txid)]);
    expect(keys[0]).toMatch(/^web:login:[0-9a-f]{64}$/);
    expect(keys[0]).not.toContain(txid);
  });

  it("expires after the configured lifetime", async () => {
    const txid = await store.begin(transaction);
    expect(redis.entries.get(loginKeyFor(txid))?.ttl).toBe(TTL_SECONDS);
  });

  it("returns null for an unknown id", async () => {
    await expect(store.consume("does-not-exist")).resolves.toBeNull();
  });

  it.each([
    ["broken JSON", "{not json"],
    ["an unsafe return path", JSON.stringify({ ...transaction, returnTo: "//evil.example" })],
  ])("refuses a transaction with %s", async (_label, payload) => {
    await redis.setEx(loginKeyFor("some-id"), TTL_SECONDS, payload);
    await expect(store.consume("some-id")).resolves.toBeNull();
    expect(redis.entries.size).toBe(0);
  });
});
