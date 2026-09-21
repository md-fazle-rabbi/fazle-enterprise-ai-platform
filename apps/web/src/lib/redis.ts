import "server-only";
import { createClient } from "redis";
import { env } from "@/env";
import type { RedisLike } from "@/lib/session/store";

// Why: Next.js can load this module more than once (per route bundle, and again after a
// hot reload). Keeping the client on globalThis stops every copy from opening its own
// connection.
const globalForRedis = globalThis as typeof globalThis & {
  webRedis?: Promise<RedisClient>;
};

async function connect() {
  const client = createClient({
    url: env.REDIS_URL,
    socket: {
      connectTimeout: 3_000,
      // Why: retry a few times, then give up, so requests fail fast instead of hanging
      // forever when Redis is down.
      reconnectStrategy: (retries) =>
        retries >= 3 ? new Error("Redis is unreachable") : retries * 200,
    },
  });
  // Why: node-redis throws and ends the process when an error has no listener.
  client.on("error", (error: unknown) => {
    console.error("Redis client error", error);
  });
  // Why: once the client has given up, forget it so the next request builds a fresh one.
  client.on("end", () => {
    globalForRedis.webRedis = undefined;
  });
  await client.connect();
  return client;
}

// Why: derived from connect()'s own return value instead of a bare
// `ReturnType<typeof createClient>`. node-redis v5's client type infers different,
// structurally incompatible generic parameters depending on which options are passed to
// createClient, so a type computed independently of the real call site can fail to match
// it even though the runtime value is identical. Tying the alias to connect()'s actual
// return keeps the two in sync everywhere the type is used, including in the integration
// test's separate createClient(...) call.
export type RedisClient = Awaited<ReturnType<typeof connect>>;

export function getRedis(): Promise<RedisClient> {
  globalForRedis.webRedis ??= connect().catch((error: unknown) => {
    globalForRedis.webRedis = undefined;
    throw error;
  });
  return globalForRedis.webRedis;
}

export function createRedisLike(client: RedisClient): RedisLike {
  return {
    async get(key) {
      const value = await client.get(key);
      return typeof value === "string" ? value : null;
    },
    async setEx(key, seconds, value) {
      await client.setEx(key, seconds, value);
    },
    async setIfExistsKeepTtl(key, value) {
      // Why: one atomic command. It writes only when the key exists and keeps the
      // remaining lifetime.
      const reply: unknown = await client.sendCommand(["SET", key, value, "XX", "KEEPTTL"]);
      return reply === "OK";
    },
    async del(key) {
      await client.del(key);
    },
    async getDel(key) {
      // Why: GETDEL reads and deletes in one atomic step. It is what makes a login
      // transaction single use.
      const value = await client.getDel(key);
      return typeof value === "string" ? value : null;
    },
  };
}
