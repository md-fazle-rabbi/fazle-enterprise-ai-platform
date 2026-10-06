import { ACQUIRE_SLOT_SCRIPT, RELEASE_SLOT_SCRIPT, SLIDING_WINDOW_SCRIPT } from "./scripts";

// Why: the only thing the limiters need from Redis. Tests pass a fake; production adapts the
// real client in lib/redis.ts.
export type RateLimitRedis = {
  evalScript(script: string, keys: string[], args: string[]): Promise<unknown>;
};

export type RateDecision =
  { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

export type StreamSlot = { release: () => Promise<void> };

// Why: a type guard narrows `unknown` to a real tuple, so callers get `number`s
// without casts or non-null assertions under `noUncheckedIndexedAccess`.
function isNumberTriple(reply: unknown): reply is [number, number, number] {
  return (
    Array.isArray(reply) && reply.length === 3 && reply.every((item) => typeof item === "number")
  );
}

function readTriple(reply: unknown): [number, number, number] {
  if (isNumberTriple(reply)) {
    return reply;
  }
  throw new Error("Unexpected reply from the rate limit script");
}

function readFlag(reply: unknown): number {
  if (typeof reply === "number") {
    return reply;
  }
  throw new Error("Unexpected reply from the stream slot script");
}

type SlidingWindowOptions = {
  redis: RateLimitRedis;
  keyPrefix: string;
  limit: number;
  windowMs: number;
  newId?: () => string;
};

export function createSlidingWindowLimiter(options: SlidingWindowOptions) {
  const { redis, keyPrefix, limit, windowMs, newId = () => crypto.randomUUID() } = options;
  return {
    async consume(subject: string): Promise<RateDecision> {
      const reply = await redis.evalScript(
        SLIDING_WINDOW_SCRIPT,
        [keyPrefix + subject],
        [String(windowMs), String(limit), newId()],
      );
      const [allowed, count, retryAfterMs] = readTriple(reply);
      if (allowed === 1) {
        return { allowed: true, remaining: Math.max(0, limit - count) };
      }
      // Why: rounded up and never below 1, so a client told "retry in 0 seconds" cannot
      // spin on the limit.
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    },
  };
}

type ConcurrencyOptions = {
  redis: RateLimitRedis;
  keyPrefix: string;
  max: number;
  holderTtlMs: number;
  newId?: () => string;
};

export function createConcurrencyLimiter(options: ConcurrencyOptions) {
  const { redis, keyPrefix, max, holderTtlMs, newId = () => crypto.randomUUID() } = options;
  return {
    async acquire(subject: string): Promise<StreamSlot | null> {
      const key = keyPrefix + subject;
      const id = newId();
      const reply = await redis.evalScript(
        ACQUIRE_SLOT_SCRIPT,
        [key],
        [String(max), String(holderTtlMs), id],
      );
      if (readFlag(reply) !== 1) {
        return null;
      }
      return {
        release: async () => {
          await redis.evalScript(RELEASE_SLOT_SCRIPT, [key], [id]);
        },
      };
    },
  };
}
