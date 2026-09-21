import "server-only";
import * as z from "zod";
import { sessionDataSchema, type SessionData } from "@/lib/session/data";

// Why: the same convention the backend uses for tenant groups (rag_engine/user_auth.py).
const TENANT_GROUP_PREFIX = "/tenants/";

const accessTokenSchema = z.object({
  exp: z.number().int().positive(),
  groups: z.array(z.string()).default([]),
  realm_access: z.object({ roles: z.array(z.string()) }).optional(),
});

const idClaimsSchema = z.object({
  sub: z.string().min(1),
  preferred_username: z.string().min(1),
  email: z.string().optional(),
});

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  idToken: string;
};

// Why: this decodes WITHOUT verifying the signature. That is fine only because the token
// arrived straight from Keycloak's token endpoint and is used to fill the UI. FastAPI
// verifies the signature on every call. Never use this to make an access decision.
export function decodeJwtPayload(token: string): unknown {
  const segment = token.split(".")[1];
  if (segment === undefined || segment === "") {
    throw new Error("Malformed JWT");
  }
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

// Why: strict on purpose. A tenant group with a malformed id makes the whole login fail,
// the same way the backend refuses such a token, instead of guessing what was meant.
export function buildSessionData(
  tokens: TokenSet,
  idClaims: unknown,
  nowSeconds: number,
): SessionData {
  const access = accessTokenSchema.parse(decodeJwtPayload(tokens.accessToken));
  const id = idClaimsSchema.parse(idClaims);
  return sessionDataSchema.parse({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    accessTokenExpiresAt: access.exp,
    createdAt: nowSeconds,
    user: {
      id: id.sub,
      username: id.preferred_username,
      email: id.email,
      tenants: access.groups
        .filter((group) => group.startsWith(TENANT_GROUP_PREFIX))
        .map((group) => group.slice(TENANT_GROUP_PREFIX.length)),
      roles: access.realm_access?.roles ?? [],
    },
  });
}
