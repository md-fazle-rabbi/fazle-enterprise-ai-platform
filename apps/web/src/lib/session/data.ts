import * as z from "zod";

// Why: everything read back from Redis is validated. Data that is missing, mistyped or
// tampered with is treated as no session at all. z.guid() is used because the demo tenant
// ids (00000000-0000-0000-0000-000000000001) are not RFC version 1 to 8 UUIDs.
export const sessionDataSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  idToken: z.string().min(1),
  accessTokenExpiresAt: z.number().int().positive(),
  createdAt: z.number().int().positive(),
  user: z.object({
    id: z.string().min(1),
    username: z.string().min(1),
    email: z.string().optional(),
    tenants: z.array(z.guid()),
    roles: z.array(z.string()),
  }),
});

export type SessionData = z.infer<typeof sessionDataSchema>;

export function parseSessionData(raw: string): SessionData | null {
  try {
    const result = sessionDataSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
