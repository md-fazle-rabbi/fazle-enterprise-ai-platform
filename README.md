# fazle-enterprise-ai-platform

![CI](https://github.com/md-fazle-rabbi/fazle-enterprise-ai-platform/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-green)
![Python](https://img.shields.io/badge/python-3.13.15-blue)
![RAGAS Faithfulness](https://img.shields.io/badge/RAGAS_faithfulness-100%25-blue)
![p95 latency (single user)](https://img.shields.io/badge/query_p95_single_user-1900ms-blue)
![Security-Reviewed](https://img.shields.io/badge/security_review-pending_Repo_2-lightgrey)

**A multi-tenant RAG and agent platform built to survive a real security and compliance review: database-enforced tenant isolation, cited answers, a kill switch, and a governance layer.**

**Fazle Rabbi, Secure Production AI Systems Engineer.** Available for freelance engagements and full time roles.
Contact: mfrabbi.ai@gmail.com | LinkedIn: https://www.linkedin.com/in/fazle-rabbi-ai/ | Loom walkthrough (watch without setup): [link]

## At a glance

| Claim | Result | Evidence |
|---|---|---|
| Tenant isolation | Enforced by Postgres Row Level Security, not app code | [`proof/rls-api-isolation.png`](proof/rls-api-isolation.png), [`proof/rls-db-state.png`](proof/rls-db-state.png) |
| Answer faithfulness | 100% RAGAS locally, CI gate at 0.90/0.85/0.80 | [`proof/ragas-scores.png`](proof/ragas-scores.png) |
| Query latency | p95 1900ms, single user, unthrottled, Locust | [`proof/langfuse-trace-detail.png`](proof/langfuse-trace-detail.png) |
| Kill switch | Under 5 seconds against a simulated runaway agent loop | [`proof/web-admin-kill-switch.png`](proof/web-admin-kill-switch.png) |
| Audit log | Hash chained, insert only, UPDATE and DELETE change nothing in the database | [`proof/audit-log-tamper-test.txt`](proof/audit-log-tamper-test.txt) |
| HIPAA Safe Harbor coverage | 10 of 18 identifiers detected, gaps named | live `/governance/documents/hipaa-report` |

*Latency is measured locally for a single user, with no third party throttling. See "Observability" for why concurrent p95 isn't published.*

## Read this first
- "SOC2-aligned" means built following SOC2 principles. It is not a SOC2 certification, which needs a third party auditor.
- Nothing here is legal advice. Governance outputs (risk classes, HIPAA and GDPR documents, vendor questionnaires) are drafting aids and coverage checks, not legal determinations.
- Security testing against a live instance needs prior written authorization.
- Every control here reduces risk. None of them, alone or together, removes it.
- The project runs locally by design. See "Run it locally" for why.

## The problem
Two things stop enterprise AI before production: it makes things up with confidence, and it leaks one customer's data into another customer's answer. Legal, security and procurement teams block launches over exactly these two.

This platform handles both at the infrastructure layer, not with prompting tricks. Postgres itself enforces tenant isolation, so no future engineer can bypass it by accident in app code. Every claim in an answer traces to a retrieved, citable source, and CI fails the build if faithfulness drops. A governance layer on top speaks the language procurement and DPO teams use: EU AI Act classification, HIPAA and GDPR documents, and a vendor risk questionnaire.

## What's inside
Four packages behind one API, plus a web app in `apps/web` (sign in with Keycloak, cited chat with saved history, a document list for the signed in tenant and an upload form).

- **rag-engine (trust).** Hybrid search (pgvector plus Postgres full text, RRF fused), enforced citation tags, a CRAG router that grades context before generation, a two layer prompt injection firewall, PII redaction for text, images and PDFs, semantic caching, and a RAGAS gate in CI.
- **agent-mesh (control).** LangGraph agents, RS256 signed agent to agent messages, Keycloak identity, OPA authorization, a two layer code sandbox, and a kill switch measured under 5 seconds.
- **observability (accountability).** End to end traces tied to structured logs, cost and latency dashboards, real load test numbers, exfiltration detection and drift monitoring.
- **governance (compliance).** EU AI Act classification on the post Digital Omnibus timeline, Colorado SB26-189 ADMT assessment, a hash chained audit log, HIPAA Safe Harbor and GDPR RoPA documents, DPIA/DSAR/erasure templates, and a 20 question vendor risk questionnaire.

**Stack:** Python 3.13, FastAPI, PostgreSQL, pgvector, Row Level Security, Redis, LangGraph, Presidio, Keycloak (OAuth2), OPA, OpenTelemetry, Langfuse, RAGAS, Locust, Docker Compose, GitHub Actions, Trivy, CodeQL.
**Frameworks covered:** OWASP LLM Top 10, agentic AI security, EU AI Act, GDPR, HIPAA.

## Architecture
```mermaid
graph TB
    User[API Client] --> API[FastAPI Service]
    API --> FW[Injection Firewall]
    FW --> PII[PII Redaction]
    PII --> PG[(Postgres + pgvector, RLS)]
    API --> Redis[(Redis)]
    API -->|embed| Voyage[Voyage AI]
    API -->|generate| Gemini[Gemini API]
    API --> Agents[Agent Mesh]
    API --> Governance["Governance: classify, documents, vendor-risk, audit"]
```

## Run it locally
This runs locally on purpose. Showing the security model honestly needs real infrastructure (Postgres, pgvector, Redis, the API). A stripped down public demo would weaken the very thing it is meant to prove.

```bash
git clone https://github.com/md-fazle-rabbi/fazle-enterprise-ai-platform.git
cd fazle-enterprise-ai-platform
docker compose up --build -d
```
Migrations run automatically before the app starts.

```bash
curl -X POST http://localhost:8000/query \
  -H "Authorization: Bearer fazle-demo-key" \
  -H "Content-Type: application/json" \
  -d '{"question": "How does this system enforce tenant isolation?"}'
```

The same pipeline also streams as Server-Sent Events. It reports each stage as it starts, then sends the checked answer or an error event. It streams progress, not model tokens, because the output checks can rewrite the answer:

```bash
curl -N -X POST http://localhost:8000/query/stream \
  -H "Authorization: Bearer fazle-demo-key" -H "Content-Type: application/json" \
  -d '{"question":"How long do customers have to request a refund?"}'
```

API docs: **http://localhost:8000/docs** once the stack is up. The Loom walkthrough at the top shows the same thing end to end.

**Web app in Docker:** `docker compose up -d --build web` builds the multi-stage, non-root image from `apps/web` and serves it on `http://localhost:3000`, the same address as `npm run dev`. The API does not change.

## Observability
Every `/query` call is traced with OpenTelemetry and exported to Langfuse. Retrieval, CRAG grading, generation and output checks each get their own span with real prompt and response content, not just timings.

- p95 latency is 1900ms for a single user, unthrottled, measured with Locust ([`proof/langfuse-trace-detail.png`](proof/langfuse-trace-detail.png)).
- Concurrent p95 is not published. The embedding provider's free tier caps at 3 requests per minute, so a higher number would measure their limit, not this application.
- The demo API key is limited to 20 requests per hour, shown by a live 429 on request 21 ([`proof/demo-rate-limit.png`](proof/demo-rate-limit.png)).
- Langfuse dashboards are limited to project members on the free tier, so screenshots stand in for a public link.

## Governance and compliance
Built for the teams that actually block AI launches.

| Endpoint | What it does |
|---|---|
| POST /classify | EU AI Act risk tier, current on the post Digital Omnibus deadlines |
| POST /classify/colorado-admt | Colorado SB26-189 automated decision technology assessment |
| POST /governance/documents/hipaa-report | HIPAA Safe Harbor coverage report with honest gaps (10 of 18 identifiers detected today) |
| GET /vendor-risk/questions, POST /vendor-risk/score | 20 question vendor AI risk questionnaire, scored 0-100 as a triage signal, not a pass/fail verdict |
| GET /audit/query, GET /audit/verify | Hash chained, insert only audit log, tamper resistance proven in the database |

DPIA, DSAR and erasure workflows are deliberately not automated by an LLM. A DPIA needs human judgment about proportionality, so these ship as structured templates a qualified person completes.

## Supply chain security
Every dependency surface is pinned, delayed or audited, and the reasoning is recorded in [ADR-028](docs/adr/ADR-028-dependency-update-and-audit-policy.md).

| Control | What it does |
|---|---|
| SHA-pinned GitHub Actions | Each action is pinned to a full commit SHA with a version comment, so a moved tag cannot change what runs. |
| Least-privilege workflows | Permissions default to `contents: read`, and checkout uses `persist-credentials: false`. |
| Pinned toolchain | uv, Python and the runner OS use explicit versions, so CI only changes when a commit changes it. |
| Dependabot with cooldown | npm, GitHub Actions, Docker and docker-compose updates wait 7 days (npm majors 14) before a PR opens, so hijacked or malicious releases are usually caught first. |
| Security updates skip the delay | Cooldown never holds back a CVE fix. |
| Grouped, scheduled PRs | Minor and patch bumps arrive as one PR per ecosystem on a fixed schedule. |
| Production dependency audit | CI runs `npm audit --omit=dev --audit-level=high` and fails on high or critical findings. |

**Limits, stated plainly:**
- Cooldown needs a registry publication date. Docker Hub gives one. quay.io and ghcr.io do not, so Keycloak and the uv image are excluded from Dependabot and bumped by hand after a monthly reminder issue.
- Dependabot's uv job fails on this workspace, so Python advisories rely on `pip-audit` in CI, which does not block the build yet.
- Cooldown is best effort for Docker: if a registry gives no date, Dependabot warns and opens the PR without a delay.

## Proof, not claims

**Isolation and data safety**
- Tenant isolation, at the API and in Postgres directly ([`proof/rls-api-isolation.png`](proof/rls-api-isolation.png), [`proof/rls-db-state.png`](proof/rls-db-state.png))
- Audit log tamper resistance: database level UPDATE and DELETE rules, tested as the owner and as the application role ([`proof/audit-log-tamper-test.txt`](proof/audit-log-tamper-test.txt))
- Chat history isolated per user and tenant by the database, including the fail-closed case ([`proof/backend-conversations-tests.png`](proof/backend-conversations-tests.png))

**Answer quality**
- RAGAS gate: 100% faithfulness locally, thresholds 0.90/0.85/0.80, enforced in CI ([`proof/ragas-scores.png`](proof/ragas-scores.png))

**Agent control**
- Kill switch under 5 seconds against a simulated runaway loop
- Reachable only with a real Keycloak token carrying `platform-admin`, toggled from the web admin view ([`proof/web-admin-kill-switch.png`](proof/web-admin-kill-switch.png))

**Authentication and sessions**
- JWT checks: forged, expired and wrong-audience tokens get 401, and a valid token for a foreign tenant gets 403 ([`proof/web-auth-2-user-jwt-tests.png`](proof/web-auth-2-user-jwt-tests.png), [`proof/web-auth-2-red-team.txt`](proof/web-auth-2-red-team.txt))
- Keycloak tokens carry tenant groups and the rag-engine-api audience, and the web client requires PKCE ([`proof/web-auth-3-alice-access-token.png`](proof/web-auth-3-alice-access-token.png), [`proof/web-auth-3-carol-access-token.png`](proof/web-auth-3-carol-access-token.png))
- Session store: hashed keys, validated reads, and updates that cannot revive a session, tested on real Redis ([`proof/web-session-store-tests.png`](proof/web-session-store-tests.png))
- Login through Keycloak with a Redis session behind an opaque cookie ([`proof/web-login-home.png`](proof/web-login-home.png), [`proof/web-login-redis-session.png`](proof/web-login-redis-session.png), [`proof/web-login-cookie-flags.png`](proof/web-login-cookie-flags.png))
- The API accepts a real Keycloak token from the web app and returns only the signed in tenant's documents ([`proof/web-documents-alice.png`](proof/web-documents-alice.png), [`proof/web-documents-bob-empty.png`](proof/web-documents-bob-empty.png), [`proof/web-token-refresh.txt`](proof/web-token-refresh.txt))

**Web app and chat**
- The scaffold builds cleanly and passes lint, typecheck, format check and all 13 tests ([`proof/web-scaffold-checks.png`](proof/web-scaffold-checks.png))
- Chat is rate limited per user and capped at two simultaneous answers, enforced atomically in Redis ([`proof/web-rate-limit.txt`](proof/web-rate-limit.txt))
- Answers save to the signed in user's history on the server, another user's conversation looks missing, and deleting needs a matching Origin ([`proof/web-history-api.txt`](proof/web-history-api.txt))
- Past chats survive a reload with citations intact and stay private per user and workspace, with an accessibility scan in the end to end test ([`proof/web-history-sidebar.png`](proof/web-history-sidebar.png), [`proof/web-e2e-pass.png`](proof/web-e2e-pass.png))

**Document upload**
- Fourteen cases through the running stack: a text file, an image and a PDF are accepted, a PDF with an injected page is rejected and the page is named, and a missing session, another origin, a wrong type, an empty file and two oversized bodies are each refused with the right status. One upload at a time and the rate limit (ten, then 429 with `Retry-After`) are in the same file ([`proof/web-upload-curl.txt`](proof/web-upload-curl.txt))
- Timing with new files on the free tier: text 5.7 s, an image 3.3 s, PDFs of 5, 10 and 20 pages 19, 39 and 92 s, with no page skipped. The route timeouts come from it ([`proof/web-upload-timing.txt`](proof/web-upload-timing.txt))
- 60 tests for the byte checks and 201 for the route and the form ([`proof/web-upload-validation-tests.txt`](proof/web-upload-validation-tests.txt), [`proof/web-upload-route-tests.txt`](proof/web-upload-route-tests.txt))
- Five browser tests for the form, with axe scans and two screenshots ([`proof/web-upload-e2e.txt`](proof/web-upload-e2e.txt), [`proof/web-upload-success.png`](proof/web-upload-success.png), [`proof/web-upload-refused.png`](proof/web-upload-refused.png))

## End to end testing
Seven Playwright tests in two spec files cover what a user sees: two for sign in and chat (`login-and-chat.spec.ts`) and five for the document upload form (`upload.spec.ts`).

The main test goes from an anonymous visit to the login redirect, signs in through the real Keycloak, asks a question and sees a cited answer. Then it reloads, reopens that chat from the sidebar and checks the cited answer comes back. An axe accessibility scan runs on the login page, the chat page with an answer, and the sidebar with loaded history.

The second test mocks a stream that ends with no answer and checks the chat shows an error and re-enables Send instead of hanging. It never calls the model.

The upload tests sign in as alice, upload a new text file and see it listed without a reload, upload the same content again and see it recognised, and see the reason when an `.exe` file is refused. The other three need no real upload: asking for a file first, a mocked rate limit answer, and a mocked slow upload that shows the progress message. An axe scan runs in four of the five. The real ones send three uploads to the real route per run, and the limit is 10 per 10 minutes, so more than three runs in ten minutes will be rate limited. Set `E2E_PROOF_DIR=../../proof` to save the two screenshots; it is off by default, so an ordinary run never rewrites them.

All of them need the full stack (`docker compose up -d db redis keycloak app` and `npm run dev` in `apps/web`), alice's tenant already holding the refund-policy document from the `/ingest` example, and alice's Keycloak password in the environment:

```bash
cd apps/web
export E2E_ALICE_PASSWORD="$(grep '^DEMO_USER_PASSWORD=' ../../.env | cut -d= -f2)"
npm run test:e2e
```

## Known limitations
Stated plainly, not left for a client to discover.

**Security posture (local showcase)**
- Web session data, including Keycloak tokens, sits unencrypted in Redis, and the compose Redis has no password or TLS.
- `ALLOW_UNAUTHENTICATED_TENANT_HEADER` defaults to `true` in compose because the load test, the RAGAS run and the research agent still send a raw `X-Tenant-ID`. Set it to `false` to require a real token.
- `proxy.ts` only checks that a session cookie exists. The real check (`getSession`, against Redis) runs inside each page, so a page that forgets it has only the optimistic gate.
- The web app sets a Content-Security-Policy with a new nonce on every page request, the login page included, and sends `nosniff`, `X-Frame-Options: DENY`, a referrer policy and a permissions policy on every path. The policy is not sent on `/api` routes, and `style-src` still allows `'unsafe-inline'`. In development the policy also allows `'unsafe-eval'` and `ws:`. The policy was read from the code and from a real response ([`proof/web-security-headers.txt`](proof/web-security-headers.txt)); no outside CSP scanner was run
- `/admin/kill-switch/*` and `/review-queue` need a Keycloak token with the `platform-admin` role, but have no network restriction (no IP allowlist).
- Keycloak runs in `start-dev` mode with an embedded database, so realm data resets when the container is recreated. The demo users (alice, bob, carol) are synthetic.
- The `app` container mounts the Docker socket for the sandbox runner. `:ro` protects only the socket file, not the API calls through it, so a compromised container could start containers on the host. A socket proxy is not in place.
- The audit log is insert only through two database rules and grants: the application role (`app_user`) can only `SELECT` and `INSERT`, and `UPDATE` and `DELETE` change nothing, as `proof/audit-log-tamper-test.txt` shows. The rules do not cover `TRUNCATE`, so the database owner can still empty the table (shown in the same file, rolled back), and the owner is a Postgres superuser that could also drop the rules. `verify_chain` checks the rows that exist, so removing the newest rows would not be detected (read from the code, not tested)

**Auth and tenancy**
- Parallel requests can refresh the same user's token at once. That is safe only while Keycloak's refresh token rotation stays off (as far as I know, its default).
- A new user starts on the first tenant in their Keycloak group list, an order Keycloak does not guarantee. They can switch with the workspace selector, and the API re-checks on every call.
- Switching workspace remounts the chat and review queue panels, so unsent text or an unsaved review note is lost. Saved chats are not.

**Query pipeline and chat**
- `POST /query/stream` streams stage events and the final answer, not tokens. If the client disconnects before the result, database writes (query log, audit entry, review item) roll back, but a Redis side effect (quota use, cache write) may already have happened. Clients must not retry an error event blindly, since a retry re-runs generation and spends quota again.
- The injection firewall middleware matches request paths exactly and only reads the JSON `question` and `text` fields, so every new endpoint that takes free text has to be added by hand; `/query`, `/query/stream` and `/ingest` go through the middleware
- `/ingest/image` and `/ingest/pdf` take file uploads, which the middleware never reads, so each handler runs the firewall on the text the vision model or OCR extracted; `tests/test_ingest_firewall.py` runs the real `assess()` function against an injected image and an injected PDF page, and `proof/pdf-image-firewall-curl.txt` shows the same through the running stack; a PDF with one blocked page is rejected as a whole
- The firewall does not scan filenames; `source_path` does not appear in `generation.py`, `query.py` or `search.py`, so those paths do not send it to the model. Text that is stored (/ingest, and text read from images and PDF pages) is refused at the flag line (0.60) instead of the block line (0.95), because an injection hidden in a long benign document scored 0.88 in a live test and would otherwise be stored. Questions are refused only at 0.95. An injection that scores below 0.60 inside long benign text was not tested. proof/classifier-redteam.txt shows the case.
- The classifier (Prompt Guard 2, 86M) reads 512 tokens at a time, so longer text is split into overlapping segments and the highest score wins; at most 64 segments (about 28,000 tokens) are scored, and anything after that is checked by the regex layer only, which `tests/test_classifier_segments.py` pins
- The classifier layer was inactive until 2026-10-09: the code compared the model's label to a Prompt Guard 1 name, so malicious verdicts became near zero scores and the regex layer did all the blocking (before the fix: `proof/web-chat-bff-red-team.txt`, after: `proof/classifier-check.txt`); the thresholds (flag 0.60, block 0.95) have only been checked against the golden set and the six cases in `evals/classifier_check.py`, so the false positive rate on real documents is unknown
- The p95 latency in the "At a glance" table was measured before the classifier fix and before long text was scored in segments, and has not been re-measured
- Re-uploading a PDF after the text redaction rules have changed does not re-redact it, unlike text and images: the PDF route returns the stored document as a duplicate
- The image and PDF routes do not handle a lost insert race the way `/ingest` does, so two identical uploads sent at the same moment may fail; this was not tested
- `/api/chat` allows 20 questions per 60 seconds per user (sliding window, counted before the body is read, so malformed requests use it up) and 2 answers at once. Limits live in Redis, hold across app instances, and fail closed if Redis is down. No other route is throttled. The login route has no limit because limiting anonymous callers needs a trusted client IP, and there is no trusted proxy here.
- Chat history is private per user and tenant (row level security needs both settings and fails closed if the user one is missing), capped at 500 conversations per user and 1,000 messages per conversation. It has no expiry or export, and deleting is permanent. Assistant messages store a copy of the retrieved source text, so later edits to a document do not change what a past answer showed. History is not an audit trail, the hash-chained log is.
- The server saves a conversation only after an answer succeeds, never from browser input. If the save fails, the answer still shows and the browser is told it was not saved. A blocked or failed question is not saved. A save can delay the question box by a few seconds (5 second API limit). Because the web tier does the saving, a user could write to their own history by calling the API directly.
- The sidebar shows the 50 most recent conversations, with no search, rename or export. Older ones stay stored but are unreachable from the interface. The list does not update live across tabs or devices, and it locks while an answer runs. Opening a past chat does not read it aloud, and that has not been tested with a real screen reader.

**Uploads and request size**
- The limits are constants in `upload_limits.py`, picked from vendor limits and arithmetic, not tuned on real documents: images 8 MiB and 50 million pixels, PDFs 10 MiB and 20 pages, text 100,000 characters and 200 chunks, questions 2,000 characters
- The byte caps cover `/ingest`, `/ingest/image`, `/ingest/pdf`, `/query`, `/query/stream` and `/search`; the other POST routes (agents, reviews, documents, governance) have no byte cap yet
- The limits stop one oversized request, not many small ones: apart from `/api/chat` and `/api/documents` in the web app no route has a rate limit, and the shared free tier embedding quota (3 requests a minute) can still be used up by a flood of small uploads from several users
- Uploads through the web app (`POST /api/documents`) are limited to 10 per 10 minutes and 1 at a time per user, counted in Redis before the body is read. Calling the backend directly has no such limit.
- The web upload route holds about two to three copies of a file in memory while it checks it, up to roughly 30 MiB for a 10 MiB PDF, one upload per user at a time; this is arithmetic, not a measurement
- The upload route waits 20 seconds for text and images and 180 seconds for a PDF. They come from one local run on the free tier (text 6 s, image 3 s, 20 page PDF 92 s, [`proof/web-upload-timing.txt`](proof/web-upload-timing.txt)), so the PDF limit keeps about twice the measured time. A timeout (504) can mean the backend finished anyway, so check the document list before uploading again
- A `.txt` or `.md` file is judged by its name and must be valid UTF-8; every other file is judged by its first bytes, not by its extension or the type the browser reports
- The upload form takes one file at a time, with no drag and drop and no cancel button. Closing the page does not stop the server, which may still finish the upload. The end to end tests scan it with axe, but it has not been tried with a real screen reader
- A client that keeps sending after a 413 can get a connection reset instead of the response; the 413 is pinned by tests, but a very large real upload was not checked in a browser or with every client
- A PDF page far larger than the page budget is rendered at a lower resolution and may read poorly, and the 20 rendered pages are held in memory together (up to 160 MiB in the worst case, not measured)
- Only PNG, JPEG and WEBP images are accepted; GIF is refused, and HEIC and HEIF are refused because Pillow here cannot read them

**Citation viewer and review queue**
- Each source shows its full retrieved text with no length cap, and there is no link back to where the answer cited it.
- The review queue has no pagination or filtering and loads every pending item for the workspace, matching the API's `/review-queue`. Who resolved an item is logged, not stored as a column.

**Testing and delivery**
- End to end tests cover one main chat path, a mocked stalled stream and the upload form, on Chromium only. They are not part of the fast `npm run check` loop because they need the full stack and a real model call.
- The web Docker image builds with a placeholder `KEYCLOAK_WEB_CLIENT_SECRET` that only satisfies `next build`. The real secret is supplied at container start.
- The web coverage gate in CI (statements 81, branches 85, functions 69, lines 82 percent) sits 2 to 3 points below measured coverage (83.54, 87.07, 71.22, 84.77), so it blocks drops without claiming high coverage. Page and route files under `src/app` have no unit tests, which is why functions coverage is about 71 percent. The gate passes at the current numbers ([`proof/web-coverage-gate.txt`](proof/web-coverage-gate.txt)) and was shown to fail by forcing `lines=99` ([`proof/web-coverage-gate-negative-test.txt`](proof/web-coverage-gate-negative-test.txt)).
- `npm audit` gates production dependencies at high severity for `apps/web` and the repo root (0 vulnerabilities at the last run). It has been shown to pass, not yet to fail on a real finding in CI. Dev dependencies are not gated.
- One dev-only advisory is open: `braces` (GHSA-vfj7-8cjw-p6xm), reached through `eslint-config-next`. No patched version is listed and it is in no production dependency. It is tracked with a review date in `docs/security-exceptions.md`.
- A signed out visitor who opens an unknown address is sent to the login page by `proxy.ts` and never sees the 404 page, because the proxy only checks for a session cookie and runs before routing
- The `global-error` page, which replaces the whole document, has a render test and was checked in a browser once by throwing from the root layout in development; its retry button has no click test
- Unknown `/api/*` paths return the HTML 404 page, not JSON (checked with curl, see `proof/web-error-pages.txt`)
- The landing page lives at `/login`, because every signed out visit is sent there and the end to end tests depend on it; its six numbers are copied by hand from the "At a glance" table, so they have to be updated together
- Only the sign in page, the buttons and the fonts have the new design; the home, chat and admin panels still use the older plain card styles
- The landing page links to GitHub and LinkedIn, which need internet; nothing on the page loads from outside the app
- The web app has only an SVG icon and no `favicon.ico` fallback, so a browser without SVG icon support shows no tab icon; Safari was not tested
- The web app sets no Open Graph tags or share image, because it runs locally and nothing fetches a link preview from it; the repository social preview image is in `docs/branding` and has to be uploaded by hand in the repository settings

**API**
- Concurrent p95 is not published (third party free tier ceiling, not an application limit).
- GraphRAG entity extraction is stored but not used in retrieval.
- Drift detection covers query embedding distribution only, not retrieval or generation quality.
- The MCP tool interface still takes `tenant_id` as an LLM-visible argument, unlike the HTTP agent path, which binds it server side.
- HIPAA Safe Harbor coverage is 10 of 18 identifiers. The live report endpoint has the current breakdown.

## About
Freelance AI engineer specializing in secure production AI systems, based in Bangladesh. This is Repo 1 of a multi repo portfolio. Repo 2 is a red team toolkit that attacks the controls built here.

Contact: mfrabbi.ai@gmail.com | LinkedIn: https://www.linkedin.com/in/fazle-rabbi-ai/

## License
MIT, see LICENSE.md.