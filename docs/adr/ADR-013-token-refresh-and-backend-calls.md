# ADR-013: Token refresh and backend calls from the web app

Status: Accepted (2026-09-26). Decision 5 amended when the tenant selector was added.

## Context
The web app calls FastAPI with the user's access token, which lives 5 minutes.
The refresh token lives in the Redis session. Calls must survive token expiry
without showing the user a login screen, and must not sign users out because
Keycloak had a bad minute.

## Decision
1. Every backend call goes through authedFetch. It adds the Bearer token and the
   X-Tenant-ID header.
2. Tokens are refreshed when fewer than 30 seconds remain. A 401 from the backend
   triggers one refresh and one retry, never a loop.
3. Only Keycloak's invalid_grant answer ends the session. Any other failure
   keeps it and is shown as "could not be reached".
4. A refresh updates the stored session in place and cannot revive a deleted or
   expired one. Tenants and roles are re-read from the new access token.
5. The tenant sent is the session's currentTenantId, which the Workspace selector
   sets. A new session starts on the first tenant in the token. authedFetch
   refuses the call if currentTenantId is null or not among the user's tenants.
   The backend checks again that the token grants it, so the web app can only
   ever narrow access.

## Options considered
- Refreshing only after a 401: rejected. Every expiry would cost a failed call.
- Signing out on any refresh failure: rejected. A short Keycloak outage would
  log everyone out.
- A background refresh timer: rejected. The server has no per user process to
  hold one, and refreshing on use is enough.
- Sending the tenant only for users with several tenants: rejected. Always
  sending it is simpler and the backend validates it either way.

## Consequences
Positive: users stay signed in as long as Keycloak allows, revocation in Keycloak
takes effect at the next refresh, and a Keycloak outage does not log anyone out.
Negative: a revoked user can keep using the app for up to one token lifetime.
Risks and mitigations:
- Parallel requests can refresh at the same time. This is harmless while
  Keycloak's refresh token rotation is off, which as far as I know is its
  default. If rotation is switched on, a lock per session is needed.
- The starting tenant is the first one in the token, and Keycloak does not
  guarantee the order of its group list. Mitigation: the user can switch
  explicitly with the Workspace selector, and both authedFetch and the backend
  re-check the tenant on every call.