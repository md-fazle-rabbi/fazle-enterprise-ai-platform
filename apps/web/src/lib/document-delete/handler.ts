import type { NextRequest } from "next/server";
import * as z from "zod";
import { NoTenantError, NotSignedInError } from "@/lib/auth/errors";
import type { Session } from "@/lib/auth/session";
import type { BackendInit } from "@/lib/backend";

const NO_STORE = { "Cache-Control": "no-store" };

export type DocumentDeleteHandlerDeps = {
  appUrl: string;
  getSession: () => Promise<Session | null>;
  call: (session: Session, path: string, init?: BackendInit) => Promise<Response>;
};

function refuse(status: number, message: string): Response {
  return Response.json({ message }, { status, headers: NO_STORE });
}

export async function handleDeleteDocument(
  request: NextRequest,
  deps: DocumentDeleteHandlerDeps,
  id: string,
): Promise<Response> {
  // Why: deleting changes data, so a request from another site must not be able to do it.
  if (request.headers.get("origin") !== deps.appUrl) {
    return refuse(403, "Refused");
  }
  const session = await deps.getSession();
  if (!session) {
    return refuse(401, "Not signed in");
  }
  if (!z.guid().safeParse(id).success) {
    return refuse(400, "Invalid document id");
  }

  let response: Response;
  try {
    response = await deps.call(session, `/documents/${id}`, { method: "DELETE" });
  } catch (error) {
    if (error instanceof NotSignedInError) {
      return refuse(401, "Not signed in");
    }
    if (error instanceof NoTenantError) {
      return refuse(409, "No workspace selected");
    }
    throw error;
  }

  await response.body?.cancel();
  if (response.status === 404) {
    return refuse(404, "Not found");
  }
  if (!response.ok) {
    return refuse(502, "Could not delete the document");
  }
  return new Response(null, { status: 204, headers: NO_STORE });
}
