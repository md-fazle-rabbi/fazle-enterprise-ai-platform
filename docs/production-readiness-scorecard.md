# Production readiness scorecard

Self assessment of `fazle-enterprise-ai-platform`, written by its author on 2026-10-15. It is not an audit and not a certification. Each row links to the proof in this repository, and each row names its biggest gap.

## How to read the status
- **Proven:** the control is built and shown working with evidence in this repository. It was shown locally, on test data. The gap in the last column still stands.
- **Partly:** some of it is built or measured, and a core part is not.
- **Not done:** not built, and the reason is stated.

## Scorecard

| Area | Status | Evidence | Biggest gap |
|---|---|---|---|
| Tenant isolation | Proven | [API isolation](../proof/rls-api-isolation.png), [database state](../proof/rls-db-state.png), [red team](../proof/web-tenant-red-team.txt) | The MCP tool interface still takes `tenant_id` as an argument the model can see. Compose accepts a raw `X-Tenant-ID` header by default. |
| Authentication and sessions | Proven | [JWT checks](../proof/web-auth-2-user-jwt-tests.png), [red team](../proof/web-auth-2-red-team.txt), [Redis session](../proof/web-login-redis-session.png), [ADR-007](adr/ADR-007-oidc-bff-user-authentication.md) | Keycloak runs in `start-dev` mode. Session data sits unencrypted in a Redis with no password or TLS. |
| Upload and input limits | Proven | [route proof](../proof/web-upload-curl.txt), [timing](../proof/web-upload-timing.txt), [red team](../proof/upload-limits-redteam.txt), [ADR-034](adr/ADR-034-request-and-upload-limits.md), [ADR-035](adr/ADR-035-web-document-upload.md) | The limits come from vendor figures and arithmetic, not real documents. Calling the backend directly skips the web rate limit. |
| Prompt injection and PII | Proven | [classifier red team](../proof/classifier-redteam.txt), [classifier check](../proof/classifier-check.txt), [PDF and image firewall](../proof/pdf-image-firewall-curl.txt), [ADR-032](adr/ADR-032-ingest-firewall-coverage.md), [ADR-033](adr/ADR-033-classifier-labels-and-segments.md) | The classifier layer did nothing until 2026-10-09 (a label mismatch, found and fixed, with proof before and after). Its thresholds are checked on a small set only. HIPAA Safe Harbor coverage is 10 of 18 identifiers. |
| Answer quality | Proven | [RAGAS table](../proof/ragas-scores.txt), [RAGAS screenshot](../proof/ragas-scores.png), [ADR-036](adr/ADR-036-retrieval-order-and-sparse-query.md) | The gate runs 5 questions over 3 one-chunk documents with a free tier judge. Answer relevancy sits within 0.02 of its floor, and a 503 from the judge ends a run. |
| Latency and load | Partly | [latency](../proof/query-latency.txt) | Single user only: p95 3.9 s cold and 1.7 s cached, 20 requests each, on a three document corpus. No concurrent p95 and no large corpus. |
| Abuse and cost limits | Partly | [demo key limit](../proof/demo-rate-limit.png), [chat limits](../proof/web-rate-limit.txt), [ADR-024](adr/ADR-024-chat-rate-limits.md) | Only `/api/chat` and `/api/documents` in the web app have a rate limit. A flood of small requests can use up the free tier embedding quota. |
| Observability | Proven | [Langfuse trace](../proof/langfuse-trace-detail.png), [Langfuse overview](../proof/langfuse-home-overview.png) | Dashboards are visible to project members only, so screenshots stand in. Drift detection covers the query embedding distribution only. |
| Agent control | Proven | [kill switch](../proof/web-admin-kill-switch.png), [admin red team](../proof/web-admin-red-team.txt), [ADR-019](adr/ADR-019-admin-authorization.md), [ADR-002](adr/ADR-002-sandboxing-approach-and-trade-offs.md) | The app container mounts the Docker socket for the sandbox runner, with no socket proxy. The kill switch has no IP allowlist. |
| Governance and audit | Proven | [audit log tamper test](../proof/audit-log-tamper-test.txt) | "SOC2-aligned" is not a SOC2 certification. The insert only rules do not cover `TRUNCATE`. |
| Supply chain and CI | Proven | [ADR-028](adr/ADR-028-dependency-update-and-audit-policy.md), [CI green](../proof/web-ci-green.png), [Dependabot](../proof/web-dependabot-tab.png), [npm audit](../proof/web-npm-audit.txt), [exceptions](security-exceptions.md) | `pip-audit` does not block the build yet. `npm audit` was shown to pass, not to fail on a real finding. One dev only advisory is open and tracked. |
| Testing | Proven | [web end to end](../proof/web-e2e-pass.txt), [upload end to end](../proof/web-upload-e2e.txt), [web coverage gate](../proof/web-coverage-gate.txt), [rag-engine tests](../proof/rag-engine-tests.txt) | End to end tests run on Chromium only. The Python coverage gate in CI covers the chunking module only. |
| Operations and deployment | Not done | [key rotation runbook](runbooks/key-rotation.md) | Runs locally by design, so there is no deployment, no backup and restore, and no incident runbook beyond key rotation. |

Count: 10 proven, 2 partly, 1 not done (by design).

## What this scorecard does not claim
- It is not a security audit, a SOC2 report or a HIPAA or GDPR certification. A third party would have to do those.
- Every figure comes from one machine, one user and a small test corpus. Concurrent load and a large corpus are not measured.
- "Proven" does not mean "safe". Every control here reduces risk and none removes it.
- Operations is "Not done" on purpose: the project runs locally so the security model can be shown on real infrastructure.
