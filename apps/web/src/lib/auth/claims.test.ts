import { describe, expect, it } from "vitest";
import { buildSessionData } from "./claims";

const NOW = 1_790_000_000;
const TENANT_A = "00000000-0000-0000-0000-000000000001";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

function tokens(payload: Record<string, unknown>) {
  return {
    accessToken: jwt({ exp: NOW + 300, ...payload }),
    refreshToken: "refresh-token",
    idToken: "id-token",
  };
}

const idClaims = { sub: "user-1", preferred_username: "alice", email: "alice@acme.example" };

describe("buildSessionData", () => {
  it("builds a session from the tokens", () => {
    const set = tokens({
      groups: [`/tenants/${TENANT_A}`],
      realm_access: { roles: ["platform-admin"] },
    });
    expect(buildSessionData(set, idClaims, NOW)).toEqual({
      accessToken: set.accessToken,
      refreshToken: "refresh-token",
      idToken: "id-token",
      accessTokenExpiresAt: NOW + 300,
      createdAt: NOW,
      user: {
        id: "user-1",
        username: "alice",
        email: "alice@acme.example",
        tenants: [TENANT_A],
        roles: ["platform-admin"],
      },
    });
  });

  it("keeps only the tenant groups", () => {
    const set = tokens({ groups: ["/admins", `/tenants/${TENANT_A}`, "/tenants-evil/x"] });
    expect(buildSessionData(set, idClaims, NOW).user.tenants).toEqual([TENANT_A]);
  });

  it("accepts a user with no groups and no roles", () => {
    const { user } = buildSessionData(tokens({}), idClaims, NOW);
    expect(user.tenants).toEqual([]);
    expect(user.roles).toEqual([]);
  });

  it("refuses a malformed tenant group", () => {
    const set = tokens({ groups: ["/tenants/not-a-uuid"] });
    expect(() => buildSessionData(set, idClaims, NOW)).toThrow();
  });

  it("refuses an access token without an expiry", () => {
    const set = { ...tokens({}), accessToken: jwt({ groups: [] }) };
    expect(() => buildSessionData(set, idClaims, NOW)).toThrow();
  });

  it("refuses a token that is not a JWT", () => {
    const set = { ...tokens({}), accessToken: "not-a-jwt" };
    expect(() => buildSessionData(set, idClaims, NOW)).toThrow(/Malformed/);
  });

  it("refuses ID claims without a username", () => {
    expect(() => buildSessionData(tokens({}), { sub: "user-1" }, NOW)).toThrow();
  });

  it("treats the email as optional", () => {
    const { email: _email, ...withoutEmail } = idClaims;
    expect(buildSessionData(tokens({}), withoutEmail, NOW).user.email).toBeUndefined();
  });
});
