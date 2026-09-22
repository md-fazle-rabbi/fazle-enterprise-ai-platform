import "server-only";
import { env } from "@/env";
import { createRedisLike, getRedis } from "@/lib/redis";
import { loginCookie, sessionCookie } from "./cookie";
import { LoginTransactionStore } from "./login-transaction";
import { RedisSessionStore } from "./store";

// Why: a login transaction only has to survive the trip to Keycloak and back.
const LOGIN_TTL_SECONDS = 600;

export async function getSessionStore(): Promise<RedisSessionStore> {
  return new RedisSessionStore(createRedisLike(await getRedis()), env.SESSION_TTL_SECONDS);
}

export async function getLoginTransactionStore(): Promise<LoginTransactionStore> {
  return new LoginTransactionStore(createRedisLike(await getRedis()), LOGIN_TTL_SECONDS);
}

export function sessionCookieSpec() {
  return sessionCookie(env.APP_URL, env.SESSION_TTL_SECONDS);
}

export function loginCookieSpec() {
  return loginCookie(env.APP_URL, LOGIN_TTL_SECONDS);
}
