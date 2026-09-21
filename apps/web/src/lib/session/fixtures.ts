import type { SessionData } from "./data";

export function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    idToken: "id-token",
    accessTokenExpiresAt: 1_800_000_000,
    createdAt: 1_790_000_000,
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      username: "alice",
      email: "alice@acme.example",
      tenants: ["00000000-0000-0000-0000-000000000001"],
      roles: [],
    },
    ...overrides,
  };
}
