# ADR-019: Admin authorization for the kill switch and review queue

Status: Accepted (2026-09-30)

## Context
/admin/kill-switch/* had no authorization at all (README already flagged the network gap,
but not this one). /review-queue existed in code but was never mounted, so it 404'd. Both
need a platform-admin identity; only review-queue also needs a tenant, since its data is
already RLS-scoped per tenant and the kill switch is a single platform-wide Redis key.

## Decision
1. AuthenticatedUser gains roles: frozenset[str], parsed from realm_access.roles the same
   way groups already parses tenants: absent is empty, present but malformed fails closed.
2. require_platform_admin (no tenant) gates the kill switch. get_admin_tenant_id /
   get_admin_session (tenant required, reusing select_tenant) gate the review queue. Both
   share one _authenticated_admin helper that refuses anything but a real Bearer JWT with
   the platform-admin role.
3. get_admin_session duplicates get_session's body rather than delegating to it through a
   nested async generator, because there is no async equivalent of sync yield from, and an
   exception's cleanup is not reliably propagated into a delegated generator's own `async
   with` block.
4. Kill switch activation, deactivation and review resolution log the acting admin's
   subject, from rag-engine's own logger. agent_mesh.kill_switch.activate() is unchanged;
   agent-mesh is out of scope for this repo without separate approval.
5. review-queue's resolve route asks for the admin identity a second time
   (Depends(require_platform_admin) alongside get_admin_session), at the cost of one extra
   token verification, because get_admin_session does not hand the caller's identity to the
   route.

## Options considered
- One combined dependency requiring a tenant for both: rejected. The kill switch has no
  tenant of its own; forcing a X-Tenant-ID on it would be meaningless and would let an
  admin of tenant A "select" a tenant to flip a platform-wide switch, implying a scoping
  that does not exist.
- Refactoring get_session/get_admin_session to share a body: rejected, see decision 3.
- Adding an actor parameter to agent_mesh.kill_switch.activate(): rejected, out of the
  approved scope for touching agent-mesh; logged from rag-engine's side instead.
- A new Postgres column (reviewed_by) on review_queue: rejected for this step, avoids a
  migration; the actor is logged instead. Revisit if the review queue becomes a real
  product surface.

## Consequences
Positive: neither endpoint group is reachable by a tenant-scoped user, the demo key, or the
raw header path any more. Tenant isolation for the review queue is enforced twice
(select_tenant, then Postgres RLS itself), demonstrated directly by a test where the wrong
tenant gets 404 from RLS hiding the row, not a 403 from application code.
Negative: resolve() does one extra JWT verification per call (its own JWKS lookup is
cached, so the added cost is small). No network-level restriction on /admin/* yet.
Risks and mitigations:
- A future admin route that forgets to use one of these two dependencies would be
  unauthenticated by default, the same way /review-queue silently 404'd until this step.
  Mitigation: none automatic yet; a route-inventory check is a candidate for CI later.