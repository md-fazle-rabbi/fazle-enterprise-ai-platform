# ADR-020: Admin view, starting with the kill switch

Status: Accepted (2026-09-30)

## Context
The backend now gates /admin/kill-switch/* and /review-queue on the platform-admin realm
role (ADR-019). The web app needs a way to reach them that never puts a token in the
browser (ADR-007) and keeps the same defenses the backend already has.

## Decision
1. requireAdminSession redirects a non-admin away from /admin. This is a UX convenience,
   not the security boundary; that remains the backend's own check.
2. authedFetch is split: fetchWithRefresh carries the shared refresh-and-retry logic,
   authedFetch requires a tenant (unchanged behavior), and a new adminFetch takes an
   optional tenant, since the kill switch has none of its own.
3. lib/admin/guard.ts centralizes the Origin, session and role checks every /api/admin/*
   route needs, pulled out once a third route was about to copy them inline the way
   /api/chat and /api/tenant each already had. The guard checks Sec-Fetch-Site (must be same-origin when present) and Origin (exact
   match required for state-changing methods) before the session and role.
4. This step ships the kill switch panel only. The review queue panel is deferred to the
   next micro-step to keep this one reviewable.

## Options considered
- Forcing adminFetch to take a tenant like authedFetch: rejected. A platform-admin with no
  tenant memberships at all would then be unable to use the kill switch for no real reason.
- One combined admin panel component for both features in this step: rejected, see
  decision 4 and the size pattern already established for other oversized steps.
- Proxying the backend's raw response body byte for byte: rejected for the POST actions,
  since the client and server should agree on an explicit shape (statusSchema, actionSchema)
  rather than trust whatever the backend happened to send.

## Consequences
Positive: the kill switch is reachable from the browser without weakening any check the
backend already enforces, and adding a third admin route did not mean a third copy of the
same guard logic.
Negative: no rate limit on repeated activate/deactivate calls from the admin UI itself,
beyond whatever the backend enforces on its own.
Risks and mitigations:
- A future admin route that forgets requireAdminRequest is unauthenticated by default.
  Mitigation: none automatic yet, same open risk noted in ADR-019.