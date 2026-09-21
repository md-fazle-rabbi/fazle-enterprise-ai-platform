import { createHash, randomBytes } from "node:crypto";
import { parseSessionData, type SessionData } from "./data";

// Why: the store only needs these four operations, so tests can use a small fake and the
// real Redis client is adapted to this shape in one place (src/lib/redis.ts).
export type RedisLike = {
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<void>;
  setIfExistsKeepTtl(key: string, value: string): Promise<boolean>;
  del(key: string): Promise<void>;
  getDel(key: string): Promise<string | null>;
};

const KEY_PREFIX = "web:session:";

// Why: Redis holds the hash of the session id, not the id. Anyone who can read Redis
// still cannot build a cookie that logs in as somebody else.
export function sessionKeyFor(sid: string): string {
  return KEY_PREFIX + createHash("sha256").update(sid).digest("hex");
}

export class RedisSessionStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly ttlSeconds: number,
  ) {}

  async create(data: SessionData): Promise<string> {
    // Why: 32 random bytes is 256 bits, far beyond guessing. A fresh id per login also
    // rules out session fixation.
    const sid = randomBytes(32).toString("base64url");
    await this.redis.setEx(sessionKeyFor(sid), this.ttlSeconds, JSON.stringify(data));
    return sid;
  }

  async get(sid: string): Promise<SessionData | null> {
    const key = sessionKeyFor(sid);
    const raw = await this.redis.get(key);
    if (raw === null) {
      return null;
    }
    const data = parseSessionData(raw);
    if (data === null) {
      // Why: unreadable data is never trusted and never left behind.
      await this.redis.del(key);
    }
    return data;
  }

  // Why: returns false when the session is gone. It never creates one, so a late token
  // refresh cannot bring back a session that was logged out or expired.
  async update(sid: string, data: SessionData): Promise<boolean> {
    return this.redis.setIfExistsKeepTtl(sessionKeyFor(sid), JSON.stringify(data));
  }

  async destroy(sid: string): Promise<void> {
    await this.redis.del(sessionKeyFor(sid));
  }
}
