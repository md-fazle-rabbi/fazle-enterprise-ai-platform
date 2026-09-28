# ADR-018: Tenant (workspace) selector

Status: Accepted (2026-09-28)

## Context
authedFetch (ADR-013) defaulted to the first tenant in the user's token, an order Keycloak
does not guarantee. A user with several tenants, such as carol, had no way to choose.
select_tenant on the backend already treats a tenant header as a selection to check against
the token, never as an authority on its own (ADR-007).

## Decision
1. SessionData gets a currentTenantId (nullable). Login sets it to the first tenant. Refresh
   re-checks it against the newly refreshed token's tenants and falls back to the first one if
   it is no longer granted, the same way a fresh login would choose.
2. authedFetch reads currentTenantId, with a membership check against user.tenants as a second
   guard, since that is the boundary between what the session claims and what the token
   actually grants.
3. POST /api/tenant follows the same Origin-check, session-check shape as /api/chat and
   /api/auth/logout, and refuses a tenant the token does not grant, mirroring the backend's
   own select_tenant. The backend still re-checks it independently; this endpoint is not a new
   trust boundary, only a place to record the user's choice.
4. The switcher calls router.refresh(), not a full page navigation, so a client component's
   own state (the chat history) is not lost by switching.
5. A tenant's label is its id's last 4 characters, because there is no tenants table and no
   Keycloak group display name to draw from.

## Options considered
- Trusting the client's chosen tenant without a server-side membership check: rejected,
  contradicts ADR-007's whole reason for existing.
- A cookie holding the current tenant, read directly by the backend: rejected. It would add a
  second, unverified channel next to the token, instead of using the one the backend already
  verifies.
- A full page reload on switch: rejected, would lose in-progress chat state for no benefit.
- Fetching tenant display names from Keycloak's admin API at render time: rejected as scope
  creep for this step; it would need a service account with admin API access on every page
  load, previously not need for anything in this app.

## Consequences
Positive: a two-tenant user can act as either, the backend was never weakened to allow it, and
losing membership to a tenant between refreshes is handled instead of assumed away.
Negative: no chat-session warning when it spans a workspace switch.
Risks and mitigations:
- If setCurrentTenant's Redis write silently failed, session and token could disagree.
  Mitigation: authedFetch's own membership re-check would still refuse the mismatched tenant
  rather than send it to the backend.