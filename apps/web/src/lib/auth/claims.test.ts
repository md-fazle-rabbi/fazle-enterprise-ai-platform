import { describe, expect, it } from "vitest";
import { applyRefresh, buildSessionData } from "./claims";

const NOW = 1_790_000_000;
const TENANT_A = "00000000-0000-0000-0000-000000000001";
const TENANT_B = "00000000-0000-0000-0000-000000000002";

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

describe("applyRefresh", () => {
  const previous = buildSessionData(tokens({ groups: [`/tenants/${TENANT_A}`] }), idClaims, NOW);

  it("replaces the tokens and the expiry and keeps who the user is", () => {
    const fresh = jwt({ exp: NOW + 900, groups: [`/tenants/${TENANT_A}`] });
    const next = applyRefresh(previous, {
      accessToken: fresh,
      refreshToken: "new-refresh",
      idToken: "new-id",
    });
    expect(next).toMatchObject({
      accessToken: fresh,
      refreshToken: "new-refresh",
      idToken: "new-id",
      accessTokenExpiresAt: NOW + 900,
      createdAt: NOW,
    });
    expect(next.user).toMatchObject({ id: "user-1", username: "alice" });
  });

  it("keeps the old refresh and ID tokens when Keycloak sends none", () => {
    const fresh = jwt({ exp: NOW + 900, groups: [`/tenants/${TENANT_A}`] });
    const next = applyRefresh(previous, { accessToken: fresh });
    expect(next.refreshToken).toBe(previous.refreshToken);
    expect(next.idToken).toBe(previous.idToken);
  });

  it("takes tenants and roles from the new access token", () => {
    const fresh = jwt({
      exp: NOW + 900,
      groups: [`/tenants/${TENANT_B}`],
      realm_access: { roles: ["platform-admin"] },
    });
    const next = applyRefresh(previous, { accessToken: fresh });
    expect(next.user.tenants).toEqual([TENANT_B]);
    expect(next.user.roles).toEqual(["platform-admin"]);
  });

  it("refuses a refreshed access token with a malformed tenant group", () => {
    const fresh = jwt({ exp: NOW + 900, groups: ["/tenants/not-a-uuid"] });
    expect(() => applyRefresh(previous, { accessToken: fresh })).toThrow();
  });
});
