import "server-only";
import { env } from "@/env";
import { getSession, type Session } from "@/lib/auth/session";
import { getSessionStore } from "@/lib/session";
import type { TenantHandlerDeps } from "./handler";

async function setCurrentTenant(session: Session, tenantId: string): Promise<boolean> {
  const sessionStore = await getSessionStore();
  return sessionStore.update(session.sid, { ...session.data, currentTenantId: tenantId });
}

export function getTenantHandlerDeps(): TenantHandlerDeps {
  return { appUrl: env.APP_URL, getSession, setCurrentTenant };
}
