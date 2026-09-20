# ADR-007: End user authentication with Keycloak OIDC and a Next.js BFF

Status: Accepted (2026-09-19)

## Context
The platform had no user login. Tenants were identified by an unverified
X-Tenant-ID header or a shared demo key, listed as the top known limitation.
A web UI needs real sign in and must not weaken the tenant isolation that
Postgres RLS already enforces. Keycloak already runs in docker-compose for
agent to agent identity.

## Decision
1. Users sign in through Keycloak (OIDC authorization code flow with PKCE).
   The Next.js server is a confidential client (backend for frontend). It
   keeps tokens server side and calls FastAPI with the access token as a
   Bearer token.
2. FastAPI verifies the token itself: RS256 only, keys from the Keycloak JWKS
   endpoint, issuer and audience (rag-engine-api) pinned, exp, iat, iss, aud
   and sub required, 30 second clock skew.
3. Tenant membership travels as Keycloak groups named /tenants/<uuid>.
   X-Tenant-ID is only a selector and must be one of the tenants in the
   token, otherwise 403.
4. The demo key and the raw X-Tenant-ID header stay for tests and curl. The
   setting ALLOW_UNAUTHENTICATED_TENANT_HEADER turns the raw header off.
5. No CORS middleware. The browser only talks to Next.js.

## Options considered
- Session built on the demo key: rejected. Login would be cosmetic, it pins
  one tenant so a tenant selector cannot work, and the 20 per hour limit is
  a single global counter.
- Tokens kept in the browser (SPA): rejected. Any XSS can read them, and the
  API would need CORS.
- Own /auth/login endpoint and users table: rejected. It reimplements
  password storage, MFA and key rotation that Keycloak already provides.
- Tenant as a user attribute: not chosen. I could not confirm how Keycloak 26
  user profile rules treat imported custom attributes. Groups need no user
  profile change.
- Keycloak Organizations: not chosen. Not verified for realm import here.
- Reuse agent_mesh.identity.jwt_auth: rejected. It is pinned to the
  agent-mesh audience, and agent-mesh is out of scope for this work.

## Consequences
Positive: closes the header trust gap on the UI path. A forged tenant header
no longer works with a token. The Stage 4 tenant selector gets a real server
side rule.
Negative: one more moving part (Keycloak must be up). Groups must be kept
per user.
Risks and mitigations:
- JWKS endpoint unreachable: 503 instead of 401, key set cached 5 minutes.
  PyJWT issue 1162 (a failed refresh wiping the cache) is fixed on master. I
  did not check whether 2.13.0 has the fix. Worst case is 503s until
  Keycloak returns, not a bypass.
- Unknown key id: as far as I know PyJWKClient re-fetches the key set for a
  kid it does not know, so a flood of random kids could cause repeated
  fetches. Mitigation: 5 second timeout now, edge rate limiting later.
- Raw header path is on by default. Mitigation: the switch above, set to
  false in compose in a later step.
- A group with extra path segments under /tenants/ fails closed (401).
- Verification is tested with generated keys first. Real Keycloak tokens are
  verified when the login flow is wired.