import "server-only";
import * as z from "zod";

// Why: one rule for every address that is an origin. The protocol check catches the classic
// typo "localhost:8000", which parses as a URL with the scheme "localhost". The path check
// keeps new URL(path, base) predictable, and the transform drops a trailing slash so
// addresses can be joined with plain string concatenation. The refine's predicate must not
// throw: new URL() throws a native TypeError for a string that isn't parseable as a URL at
// all, and that throw would escape safeParse uncaught instead of becoming a normal
// validation issue. Catching it and returning false keeps every failure inside Zod's error
// reporting.
const origin = (fallback: string) =>
  z
    .url({ protocol: /^https?$/ })
    .refine((value) => {
      try {
        return new URL(value).pathname === "/";
      } catch {
        return false;
      }
    }, "must be an origin such as http://localhost:8000")
    .transform((value) => new URL(value).origin)
    .default(fallback);

const schema = z.object({
  BACKEND_URL: origin("http://localhost:8000"),
  // Why: the address of this app itself. It must match the redirect URI registered in Keycloak.
  APP_URL: origin("http://localhost:3000"),
  // Why: Keycloak as the browser reaches it. Tokens carry this address as their issuer.
  KEYCLOAK_PUBLIC_URL: origin("http://localhost:8080"),
  // Why: Keycloak as this server reaches it. Inside Docker Compose this is http://keycloak:8080.
  KEYCLOAK_INTERNAL_URL: origin("http://localhost:8080"),
  // Why: the realm name goes into URLs, so only plain characters are allowed.
  KEYCLOAK_REALM: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .default("agent-mesh"),
  KEYCLOAK_CLIENT_ID: z.string().min(1).default("fazle-web"),
  // Why: no default. A missing secret must stop the app, not fall back to a guessable one.
  KEYCLOAK_WEB_CLIENT_SECRET: z.string().min(16),
  // Why: database 1 keeps web sessions apart from the backend's data in database 0.
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).default("redis://localhost:6379/1"),
  // Why: bounds of 5 minutes and 7 days stop a typo from making sessions that expire at once
  // or live for months. Environment values are strings, so the number is coerced.
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(604_800).default(28_800),
});

export function parseEnv(source: Record<string, string | undefined>) {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Why: z.prettifyError() renders some issue types (like a bare invalid-URL
    // failure) without the field path attached, which breaks callers that match
    // on the variable name. Building the message from result.error.issues
    // guarantees every line names its field, whichever validator produced it.
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${message}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
