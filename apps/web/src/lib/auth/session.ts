import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionStore, sessionCookieSpec } from "@/lib/session";
import type { SessionData } from "@/lib/session/data";

export type Session = {
  sid: string;
  data: SessionData;
};

// Why: this is the real check. proxy.ts only looks for a cookie, and a cookie can be forged
// or left over. Here the id is looked up in Redis, and no data there means no session.
export async function getSession(): Promise<Session | null> {
  const sid = (await cookies()).get(sessionCookieSpec().name)?.value;
  if (!sid) {
    return null;
  }
  const data = await (await getSessionStore()).get(sid);
  return data ? { sid, data } : null;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
