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

const ADMIN_ROLE = "platform-admin";

// Why: a UX convenience only. The real boundary is the backend's own platform-admin check
// (rag_engine.db._authenticated_admin) -- this redirect only saves a signed in but
// unauthorized user the trip of seeing a 403 from an API call.
export async function requireAdminSession(): Promise<Session> {
  const session = await requireSession();
  if (!session.data.user.roles.includes(ADMIN_ROLE)) {
    redirect("/");
  }
  return session;
}
