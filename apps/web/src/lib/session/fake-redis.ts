import type { RedisLike } from "./store";

// Why: a tiny in-memory stand-in for Redis, shared by the store tests. It keeps the
// lifetime it was given so tests can check it, and it mirrors the semantics of the real
// commands: setIfExistsKeepTtl only writes when the key exists, getDel reads and removes
// in one step.
export class FakeRedis implements RedisLike {
  readonly entries = new Map<string, { value: string; ttl: number }>();

  async get(key: string) {
    return this.entries.get(key)?.value ?? null;
  }

  async getDel(key: string) {
    const value = this.entries.get(key)?.value ?? null;
    this.entries.delete(key);
    return value;
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
