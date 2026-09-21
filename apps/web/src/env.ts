import "server-only";
import * as z from "zod";

const schema = z.object({
  // Why: the protocol check catches the classic typo "localhost:8000", which parses as a
  // URL with the scheme "localhost". The path check keeps new URL(path, base) predictable.
  // The refine's predicate must not throw: new URL() throws a native TypeError for a
  // string that isn't parseable as a URL at all, and that throw would escape safeParse
  // uncaught instead of becoming a normal validation issue. Catching it and returning
  // false keeps every failure inside Zod's error reporting.
  BACKEND_URL: z
    .url({ protocol: /^https?$/ })
    .refine((value) => {
      try {
        return new URL(value).pathname === "/";
      } catch {
        return false;
      }
    }, "must be an origin such as http://localhost:8000")
    .default("http://localhost:8000"),
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
