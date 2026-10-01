# ADR-021: Review queue panel

Status: Accepted (2026-10-01)

## Context
The backend's /review-queue (ADR-019) is tenant-scoped, unlike the kill switch. The web app
already has a tenant selector (ADR-018) and an admin guard (ADR-020). Flag reasons are
hidden from end users in the chat UI (ADR-016), for a different reason than what applies
here.

## Decision
1. handleGetReviewQueue checks currentTenantId before calling the backend at all. No tenant
   selected is its own state (tenantSelected: false), not an error.
2. flag_reasons is shown in full to an admin reviewing the queue. Hiding it from end users
   was about not leaking which security signal fired to someone who might be probing for
   it; an admin's whole job here is knowing which signal fired.
3. ReviewQueuePanel is keyed on the current tenant (session.data.currentTenantId) at its
   call site in app/admin/page.tsx. Its own useEffect only runs once per mount and it takes
   no props tying it to the tenant, so without the key a workspace switch via
   router.refresh() would leave the previous tenant's items on screen. KillSwitchPanel
   needs no such key: its data has no tenant to go stale against.
4. lib/admin/review-queue/server.ts duplicates kill-switch/server.ts almost exactly. Left
   as is, consistent with the rule of three from ADR-020 -- this is the second admin
   server.ts, not yet the third.

## Options considered
- Passing currentTenantId as a prop and reading it in a useEffect dependency array instead
  of a key: rejected. The key remounts and resets all of the panel's internal state (which
  item's note is open) in one step, rather than needing the effect logic to also account
  for that.
- Loading the review queue as part of the server component (like documents.ts) instead of
  a client component with its own /api/admin/review-queue route: rejected, because
  resolving an item needs interactive, client side state (which item's note field is open)
  that a server component can't hold.

## Consequences
Positive: switching workspace never shows a stale queue. An admin sees exactly why each
item was flagged, without that reason ever being exposed to the user who triggered it.
Negative: no pagination; a workspace with many pending items loads them all. An open,
unsaved note is lost on a workspace switch, since the whole panel remounts.
Risks and mitigations:
- Two nearly identical admin server.ts files. Mitigation: the rule of three sets an
  explicit, already-stated trigger for when to extract a shared one.