import { createHash, randomBytes } from "node:crypto";
import * as z from "zod";
import { safeReturnTo } from "@/lib/auth/return-to";
import type { RedisLike } from "./store";

// Why: everything read back is validated, including the return path, so a tampered
// transaction is refused instead of trusted.
export const loginTransactionSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  codeVerifier: z.string().min(1),
  returnTo: z.string().refine((value) => safeReturnTo(value) === value, "unsafe return path"),
});

export type LoginTransaction = z.infer<typeof loginTransactionSchema>;

const KEY_PREFIX = "web:login:";

// Why: like sessions, Redis holds the hash of the id, not the id.
export function loginKeyFor(txid: string): string {
  return KEY_PREFIX + createHash("sha256").update(txid).digest("hex");
}

export class LoginTransactionStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly ttlSeconds: number,
  ) {}

  async begin(transaction: LoginTransaction): Promise<string> {
    const txid = randomBytes(32).toString("base64url");
    await this.redis.setEx(loginKeyFor(txid), this.ttlSeconds, JSON.stringify(transaction));
    return txid;
  }

  // Why: getDel reads and deletes in one step, so a callback URL works once. Replaying it
  // finds nothing. Unreadable or unsafe data is refused and, because it was removed by the
  // same call, never left behind.
  async consume(txid: string): Promise<LoginTransaction | null> {
    const raw = await this.redis.getDel(loginKeyFor(txid));
    if (raw === null) {
      return null;
    }
    try {
      const result = loginTransactionSchema.safeParse(JSON.parse(raw));
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }
}
