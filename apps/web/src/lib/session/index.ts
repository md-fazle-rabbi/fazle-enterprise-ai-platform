import "server-only";
import { env } from "@/env";
import { createRedisLike, getRedis } from "@/lib/redis";
import { RedisSessionStore } from "./store";

export async function getSessionStore(): Promise<RedisSessionStore> {
  return new RedisSessionStore(createRedisLike(await getRedis()), env.SESSION_TTL_SECONDS);
}
