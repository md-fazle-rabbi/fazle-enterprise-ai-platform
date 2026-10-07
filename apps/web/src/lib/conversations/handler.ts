import type { NextRequest } from "next/server";
import * as z from "zod";
import { NoTenantError, NotSignedInError } from "@/lib/auth/errors";
import type { Session } from "@/lib/auth/session";
import type { BackendInit } from "@/lib/backend";
import { chatResultSchema } from "@/lib/chat/events";

const NO_STORE = { "Cache-Control": "no-store" };

const listSchema = z.array(
  z.object({ id: z.guid(), title: z.string(), created_at: z.string(), updated_at: z.string() }),
);

// Why: a stored result that no longer matches today's schema becomes null, so that one
// message shows as plain text instead of the whole conversation failing to open.
const storedResult = z.unknown().transform((value) => {
  const parsed = chatResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
});

const detailSchema = z.object({
  id: z.guid(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  messages: z.array(
    z.object({
      id: z.guid(),
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      result: storedResult,
      created_at: z.string(),
    }),
  ),
});

export type ConversationsHandlerDeps = {
  appUrl: string;
  getSession: () => Promise<Session | null>;
  call: (session: Session, path: string, init?: BackendInit) => Promise<Response>;
};

function refuse(status: number, message: string): Response {
  return Response.json({ message }, { status, headers: NO_STORE });
}

type BackendOutcome = { response: Response } | { refusal: Response };

async function callBackend(
  deps: ConversationsHandlerDeps,
  session: Session,
  path: string,
  init?: BackendInit,
): Promise<BackendOutcome> {
  try {
    return { response: await deps.call(session, path, init) };
  } catch (error) {
    if (error instanceof NotSignedInError) {
      return { refusal: refuse(401, "Not signed in") };
    }
    if (error instanceof NoTenantError) {
      return { refusal: refuse(409, "No workspace selected") };
    }
    throw error;
  }
}

export async function handleListConversations(deps: ConversationsHandlerDeps): Promise<Response> {
  const session = await deps.getSession();
  if (!session) {
    return refuse(401, "Not signed in");
  }
  const outcome = await callBackend(deps, session, "/conversations?limit=50");
  if ("refusal" in outcome) {
    return outcome.refusal;
  }
  if (!outcome.response.ok) {
    await outcome.response.body?.cancel();
    return refuse(502, "Could not load conversations");
  }
  const parsed = listSchema.safeParse(await outcome.response.json().catch(() => null));
  if (!parsed.success) {
    return refuse(502, "The backend sent an unexpected answer");
  }
  return Response.json(
    {
      conversations: parsed.data.map((item) => ({
        id: item.id,
        title: item.title,
        updatedAt: item.updated_at,
      })),
    },
    { headers: NO_STORE },
  );
}

export async function handleGetConversation(
  deps: ConversationsHandlerDeps,
  id: string,
): Promise<Response> {
  const session = await deps.getSession();
  if (!session) {
    return refuse(401, "Not signed in");
  }
  if (!z.guid().safeParse(id).success) {
    return refuse(400, "Invalid conversation id");
  }
  const outcome = await callBackend(deps, session, `/conversations/${id}`);
  if ("refusal" in outcome) {
    return outcome.refusal;
  }
  if (outcome.response.status === 404) {
    await outcome.response.body?.cancel();
    return refuse(404, "Not found");
  }
  if (!outcome.response.ok) {
    await outcome.response.body?.cancel();
    return refuse(502, "Could not load the conversation");
  }
  const parsed = detailSchema.safeParse(await outcome.response.json().catch(() => null));
  if (!parsed.success) {
    return refuse(502, "The backend sent an unexpected answer");
  }
  return Response.json(
    {
      id: parsed.data.id,
      title: parsed.data.title,
      messages: parsed.data.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        result: message.result,
        createdAt: message.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}

export async function handleDeleteConversation(
  request: NextRequest,
  deps: ConversationsHandlerDeps,
  id: string,
): Promise<Response> {
  // Why: deleting changes data, so a request from another site must not be able to do it.
  // GETs above skip this check: browsers send no Origin on a same-origin GET, and a page on
  // another site cannot read the response (there are no CORS headers).
  if (request.headers.get("origin") !== deps.appUrl) {
    return refuse(403, "Refused");
  }
  const session = await deps.getSession();
  if (!session) {
    return refuse(401, "Not signed in");
  }
  if (!z.guid().safeParse(id).success) {
    return refuse(400, "Invalid conversation id");
  }
  const outcome = await callBackend(deps, session, `/conversations/${id}`, { method: "DELETE" });
  if ("refusal" in outcome) {
    return outcome.refusal;
  }
  await outcome.response.body?.cancel();
  if (outcome.response.status === 404) {
    return refuse(404, "Not found");
  }
  if (!outcome.response.ok) {
    return refuse(502, "Could not delete the conversation");
  }
  return new Response(null, { status: 204, headers: NO_STORE });
}
