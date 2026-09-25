import "server-only";
import * as z from "zod";
import { authedFetch } from "@/lib/auth/authed-fetch";
import { NoTenantError, NotSignedInError } from "@/lib/auth/errors";
import { refreshAccessToken } from "@/lib/auth/oidc";
import type { Session } from "@/lib/auth/session";
import { backendFetch, type BackendInit } from "@/lib/backend";
import { getSessionStore } from "@/lib/session";
import type { SessionData } from "@/lib/session/data";

// Why: the backend's answer is checked before the page trusts it.
const documentListSchema = z.array(z.object({ id: z.guid(), source_path: z.string() }));

export type DocumentSummary = z.infer<typeof documentListSchema>[number];

export type DocumentsResult =
  | { status: "ok"; documents: DocumentSummary[] }
  | { status: "no-tenant" }
  | { status: "signed-out" }
  | { status: "error"; message: string };

export type AuthedFetcher = (
  sid: string,
  session: SessionData,
  path: string,
  init?: BackendInit,
) => Promise<Response>;

export async function loadDocuments(
  fetcher: AuthedFetcher,
  session: Session,
): Promise<DocumentsResult> {
  try {
    const response = await fetcher(session.sid, session.data, "/documents");
    if (!response.ok) {
      await response.body?.cancel();
      return { status: "error", message: `The backend answered ${response.status}` };
    }
    const body: unknown = await response.json().catch(() => null);
    const parsed = documentListSchema.safeParse(body);
    return parsed.success
      ? { status: "ok", documents: parsed.data }
      : { status: "error", message: "The backend sent an unexpected answer" };
  } catch (error) {
    if (error instanceof NotSignedInError) {
      return { status: "signed-out" };
    }
    if (error instanceof NoTenantError) {
      return { status: "no-tenant" };
    }
    return { status: "error", message: "The backend could not be reached" };
  }
}

export async function listDocuments(session: Session): Promise<DocumentsResult> {
  const sessionStore = await getSessionStore();
  const fetcher: AuthedFetcher = (sid, data, path, init) =>
    authedFetch(
      {
        sessionStore,
        refreshTokens: refreshAccessToken,
        backendFetch,
        nowSeconds: () => Math.floor(Date.now() / 1000),
      },
      sid,
      data,
      path,
      init,
    );
  return loadDocuments(fetcher, session);
}
