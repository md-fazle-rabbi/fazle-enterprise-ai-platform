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
6. Realm shape. The web client is confidential, uses PKCE and exact
   redirect URIs, and gets one explicit client scope (rag-engine-web) that
   holds every claim the backend needs. Its secret and the demo password
   come from .env through placeholders. KC_HOSTNAME pins the issuer.

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
- Rely on Keycloak's built-in scopes (basic, profile, roles): rejected. The
  import file defines its own clientScopes array, and community reports say
  that suppresses the built-in ones, which would leave tokens without sub.
  This comes from those reports, not the official docs, so the token check
  in the admin console is the proof.

## Consequences
Positive: closes the header trust gap on the UI path. A forged tenant header
no longer works with a token. The Stage 4 tenant selector gets a real server
side rule.
Negative: one more moving part (Keycloak must be up). Groups must be kept
per user.
Risks and mitigations:
- JWKS endpoint unreachable: 503 instead of 401, key set cached 5 minutes.
  PyJWT 2.13.0 and later keep the cached key set when a refresh fails
  (GHSA-fhv5-28vv-h8m8), so a short outage does not log everyone out.
- Unknown key id: PyJWKClient re-fetches the key set for a kid it does not
  know. PyJWT 2.14.0 limits those repeated refreshes (GHSA-2gx3-rcp4-g85q),
  so rag-engine requires pyjwt>=2.14. Edge rate limiting is still a later
  item.
- Empty Bearer token: an `Authorization: Bearer` header with nothing after
  it must be treated as no token, not a failed login attempt, or it blocks
  the fallback paths (`X-Tenant-ID`, demo key) that are supposed to catch
  exactly that case. Both `get_tenant_id` and `resolve_demo_tenant` now
  check for this explicitly rather than relying on truthiness alone.
- Raw header path is on by default. Mitigation: the switch above, set to
  false in compose in a later step.
- A group with extra path segments under /tenants/ fails closed (401).
- Verification is tested with generated keys first. Real Keycloak tokens are
  verified when the login flow is wired.
- Env placeholders in realm files are documented, but older issues report
  failures. Mitigation: the manual login check proves the password and
  secret were substituted.
- start-dev keeps data inside the container, so a recreate resets the
  realm. Acceptable for a local showcase, listed in Known limitations.