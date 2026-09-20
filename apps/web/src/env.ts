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
});

export function parseEnv(source: Record<string, string | undefined>) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${message}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
