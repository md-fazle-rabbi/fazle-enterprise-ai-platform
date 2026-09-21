# Changelog

## [Unreleased]

## 2026-09-20

## Web
- Added a Redis backed session store for the web app: 256 bit random session
  ids, Redis keys hold only the hash of the id, data is validated on every read,
  and updates cannot revive or extend a session. Web sessions use Redis
  database 1. Not connected to a login yet.
- Added REDIS_URL and SESSION_TTL_SECONDS settings with bounds.
- Added the pieces the login flow will stand on: cookie rules (httpOnly, SameSite
  Lax, `__Host-` names over https), a return path check that only allows local
  paths, a single use login transaction store for PKCE, state and nonce, and
  strict extraction of the user, tenants and roles from the tokens. Not
  connected to a login route yet.
- Added the OIDC client for the web app (openid-client): login request with
  PKCE, state and nonce, callback completion with ID token signature checking,
  and the logout URL. Built without discovery so browser facing and server
  facing Keycloak addresses stay separate. Tested against a simulated Keycloak
  (state, nonce, wrong key, error response, missing refresh token).
- Added APP_URL, KEYCLOAK_PUBLIC_URL, KEYCLOAK_INTERNAL_URL, KEYCLOAK_REALM,
  KEYCLOAK_CLIENT_ID and KEYCLOAK_WEB_CLIENT_SECRET settings. The client
  secret is required and has no default.

## 2026-09-20

## Security
- Added Keycloak JWT verification for end users (RS256 only, issuer and
  audience pinned). Tenant comes from the token's `/tenants/<uuid>` groups;
  `X-Tenant-ID` only selects among tenants the token already grants (403
  otherwise). Demo key path unchanged, now checked with a constant-time
  compare.
- Added `ALLOW_UNAUTHENTICATED_TENANT_HEADER` (default true) to let a
  deployment refuse the raw header path.
- Added a confidential `fazle-web` Keycloak client: authorization code flow
  with PKCE required, no password grant, no implicit flow, exact redirect
  URI. Secret and demo password come from `.env`, not git.
- Added tenant groups (`/tenants/<uuid>`), a `platform-admin` role, and
  three synthetic users. One explicit client scope (`rag-engine-web`) puts
  `sub`, the `rag-engine-api` audience, groups, roles, username and email
  in the token.
- Turned on brute force protection for the realm.

## Fixed
- An empty `Authorization: Bearer` header was wrongly rejected with 401
  instead of falling through to the `X-Tenant-ID`/demo-key path, in both
  `db.py` and `demo_auth.py`. Caught by the red-team script; now covered
  by a test.

## Tests
- Added `tests/test_user_auth.py`: forged/expired/wrong-audience tokens,
  malformed groups, JWKS outage, tenant selection, all three login paths,
  and the empty-bearer fallback. 29 tests, no Keycloak or DB needed.

## Build
- Bumped PyJWT to 2.14 (limits repeated JWKS refreshes, rejects JWKS
  redirects, tighter HMAC checks).

## Infra
- Pinned the Keycloak issuer to `http://localhost:8080` with dynamic
  backchannel, so tokens carry the same issuer inside and outside Docker.
- `app` now gets `KEYCLOAK_URL`/`KEYCLOAK_PUBLIC_URL`; the raw-header
  switch (`ALLOW_UNAUTHENTICATED_TENANT_HEADER`) stays true by default
  since the load test, RAGAS run and research agent still use it.

## Web
- Added `apps/web`: Next.js 16 (App Router), TypeScript strict, Tailwind 4,
  ESLint flat config, Prettier, Vitest and Testing Library. The environment is
  validated with zod. The home page shows whether the backend is reachable,
  and `/api/health` reports that the web process is alive.
- Added basic security headers and removed the X-Powered-By header.
- The app targets Node 24 LTS. Node 20 reached end of life in April 2026.

## 2026-09-16

## Observability
- Added a real span for each `/query` stage (`retrieval`, `crag.grade_relevance`,
  `gemini.generate_answer`, `output_checks`) with input/output captured, so
  Langfuse shows actual prompts and answers instead of blank/undefined.
- Excluded `/health` from tracing, Docker's health check was flooding the
  trace list every 10 seconds with no diagnostic value.

## Fixes
- Added the missing `GRANT` migration for `query_log`, it had RLS but no
  privileges, so every `/query` call failed on insert.
- Pinned Presidio to `en_core_web_sm` explicitly. Left unconfigured it
  defaulted to a model that isn't installed and crashed trying to
  auto-download it (pip was stripped from the runtime image).

## Build
- Added `--inexact` to `uv sync` so it stops deleting the spaCy model
  installed by a separate download step.
- Reordered the spaCy download and `tesseract-ocr` install ahead of the
  source `COPY` layers, so source edits no longer force a redownload.
- Added a BuildKit GC policy (`buildkitd.toml`) to cap local build cache,
  it was growing unbounded (17.8GB) with no policy in place.

## Infra
- Added a `migrate` service that runs `alembic upgrade head` before `app`
  starts, no more separate manual migration step.

## 2026-09-15

### Added
- Single-user `/query` load test: 28 requests/12min, 0 failures, p50 1100ms,
  p95 1900ms (proof/full-pipeline_stats.csv). README p95 badge and load-test
  limitation section added, scoped to single-user.
- Proof screenshots wired into README next to the claims they back: RAGAS 100%
  faithfulness, RLS isolation (API + DB), local CI run, demo rate limiter.

### Fixed
- `loadtest/locustfile.py`: `FullPipelineUser.wait_time` (1-3s -> 22-28s) — prior
  spacing exceeded Voyage's 3 RPM cap even at `--users 1`, producing 27000-78000ms
  p95/p99 that was retry backoff, not real latency.
- README misattributed the demo rate limiter as per-minute/`/query`-wide. Actual
  mechanism per `demo_auth.py`: Redis-backed, 20 req/hour, public demo key only.

## 2026-09-14

### Fixed
- Langfuse OTel trace export failing with 401 — `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` were not forwarded from `.env` into the `app` container.
- `/query` and `/ingest` failing with 500 due to Postgres rejecting an SSL upgrade — SSL is now gated on `environment != "development"` instead of hostname matching, so local/docker-compose Postgres connects without SSL.
- Injection-detection model (Prompt Guard 2) re-downloading from Hugging Face on every request — added a persistent `hf-cache` volume and a startup warm-up call in `lifespan`, replacing the implicit lazy load on first request.
- Hugging Face cache volume mount failing with `PermissionError` — pre-create `/home/appuser/.cache/huggingface` with correct ownership in the Dockerfile before switching to `appuser`.
- CI: bumped `actions/checkout` to v7.0.1, resolving Node 20 deprecation warning.

### Changed
- `core/db.py`: `make_engine` SSL logic now environment-based, not hostname-based.
- `main.py`: classifier pipeline now loads eagerly at startup instead of lazily on first `/query`/`/ingest` request.
- `docker-compose.yml`: added `hf-cache` volume and Langfuse env passthrough for the `app` service.

## 2026-09-13 — Agent mesh, MCP, messaging, identity & authz

**Added:** first LangGraph agent (`create_agent` + rag-engine tool call), MCP tool interface via standalone `fastmcp`, signed inter-agent messaging over Redis Streams (RS256, `XAUTOCLAIM` retry, dead-letter after 3 attempts), Keycloak identity (RS256-only, `client_credentials`), OPA policy-as-code authorization.

**Changed:** LLM provider switched to Gemini 3.5 Flash-Lite across `rag-engine`/`governance`/`agent-mesh`; `langgraph` now resolved transitively via `langchain` instead of direct pin.

**Fixed:** `fastmcp` constructor kwarg change, missing `decode_responses=True` on Redis client, `StructuredTool` mock-patching in tests, wrong OPA image tag (`-envoy` → plain), Keycloak token audience mismatch.

- **Security:** `agent_mesh.sandbox.ast_scanner` failed to block `from X import Y`-style imports of dangerous modules (e.g. `from subprocess import run`), only catching plain `import X`. Both forms are now blocked.
- `agent-mesh` package now passes `mypy --strict` (was previously not enforced/passing).
- Fixed a source/test file content swap in `agent_mesh/mcp_server.py` that caused a circular import.

## 2026-09-02
- Redact PII in image/PDF ingestion before embedding/storage (previously text-only)

### 2026-08-30
- Fixed CI failing on `gated repo` (`meta-llama/Llama-Prompt-Guard-2-86M`) inside `test`/`ragas-gate`: added `HF_TOKEN` as a repo secret and wired it into both jobs' `env:` block — the injection-firewall classifier needs authenticated HuggingFace access, unlike the local dev machine where the token was already set.
- Fixed a follow-on CI failure (`asyncpg.exceptions.InvalidPasswordError` for `app_user`): `APP_DATABASE_URL`'s embedded password and the standalone `APP_DB_PASSWORD` setting didn't match in `ci.yml`'s defaults, only aligned locally via `.env`. Set both explicitly and identically in CI.
- Fixed `ragas-gate` still referencing a stale `ANTHROPIC_API_KEY` from before the Gemini-judge switch; replaced with `GEMINI_API_KEY`.
- Added `python-multipart` dependency, missing since the image/PDF ingest routes (`ingest_image.py`, `ingest_pdf.py`) started using FastAPI form parsing — this had been silently breaking `test_ingest.py`/`test_query.py` collection in CI.
- Mocked Voyage embeddings, Gemini generation, and the injection-firewall classifier in `tests/conftest.py` for `test_ingest.py`/`test_query.py`, so the `test` job no longer needs live API keys, gated-model access, or shares Voyage's rate limit with `ragas-gate` — removed the now-unnecessary `pytest.mark.skipif` guards from both test files.
- Migrated `pdf.py` off the deprecated `fitz` import alias to `pymupdf` (same API, PyMuPDF's current recommended import name).
- Wired the RAGAS eval harness (`evals/run_ragas.py`) as a passing gate: fixed `LifespanManager` not triggering FastAPI startup (missing `session_factory`), Voyage's no-payment-method 3 RPM cap via backoff+retry, RAGAS's default OpenAI-embeddings fallback for `context_precision` (swapped to Gemini), `gemini-3.5-flash-lite` rejecting multi-candidate requests in `answer_relevancy` (`strictness=1`), and a genuine eval-script bug where `contexts` was built from the LLM's *cited* chunks instead of everything actually *retrieved* — silently understating faithfulness/context_precision whenever the model omitted a `[N]` tag. Added `retrieved_context` to `/query`'s response for eval-time visibility into full retrieval, separate from citations. Scoped `top_k=2` to the eval script only (production default untouched) since the 3-document golden corpus made `top_k=5` retrieve everything regardless of relevance. Fixed a binary floating-point false-negative in the gate's own PASS/FAIL comparison (`0.7999999999999999 < 0.80`). Result: faithfulness 1.00, answer_relevancy and context_precision passing their floors.
- Enabled Meta's Prompt Guard 2 (`Llama-Prompt-Guard-2-86M`) for the injection/jailbreak classifier — gated model, license accepted, HF token wired via `load_dotenv()` in `core/settings.py` so non-pydantic-settings libraries (`transformers`, `huggingface_hub`) also see repo-root `.env` values through `os.environ`.

### 2026-08-29
- Fixed CI unable to run at all: repo's Actions permissions policy was set to "selected actions only" with an empty allow-list, silently blocking every workflow trigger (`startup_failure`, 0s elapsed) with no visible error in the Actions log. Added `astral-sh/setup-uv` and `aquasecurity/trivy-action` (both pinned to commit SHA) to the allow-list.
- Fixed a second `startup_failure` after enabling "require actions pinned to full commit SHA": every GitHub-owned action (`actions/checkout@v4`, `actions/upload-artifact@v4`, `github/codeql-action/*@v3`) was still tag-pinned, not SHA-pinned. Pinned all five to their current commit SHAs.
- Hardened `packages/rag-engine/Dockerfile`: patch OS-level CVEs at build time (`apt-get upgrade`) and strip `pip`/`setuptools`/`wheel` from the runtime image's system site-packages — these come from the base image's own `ensurepip`, invisible to `uv.lock`, and were the actual source of the CRITICAL/HIGH CVEs Trivy flagged, not this project's own dependencies. Rejected a `distroless/base-debian13` runtime after review: it doesn't ship `libffi`/`zlib`/etc. that CPython's own extension modules dynamically link against — would have passed Trivy but risked a container that fails to boot.
- Added a boot-level smoke test to `build-and-scan` (`docker run ... python -c "import rag_engine.main"`) before the Trivy scan, so a broken image is caught by a fast functional check rather than only by a CVE scanner that can't tell whether the app actually starts.
- Fixed `ruff --strict` / `mypy --strict` failures surfaced by the first real CI run: unsorted imports, `Union[X, Y]` → `X | Y`, missing generic type args on `dict`, unused imports across `alembic/versions/`, `main.py`, `test_query.py`, `test_search.py`.
- Fixed `mypy --strict` errors in `generation.py`: `list[dict]` missing type arguments, and `response.text` (typed `str | None` by the Gemini SDK) returned directly from a function typed `-> str`. Now raises `RuntimeError` on `None` instead of silently returning an unverified empty string — deliberate for a RAG system where a silently-empty answer is worse than a visible failure.
- Fixed `core/llm_client.py` constructing the Gemini client eagerly at module import time, which meant importing `rag_engine.main` — done by every test that imports the FastAPI app — required a live `GEMINI_API_KEY` even for tests that never call Gemini. Client is now built lazily via `get_client()` (`functools.lru_cache`), constructed only on first actual use.
- Added Gemini token-usage logging (`cached_content_token_count`, `prompt_token_count`) per `generate_answer` call, to observe implicit context-cache hit rate under real traffic (Gemini 2.5+ models cache automatically; no explicit `caches.create()` needed at current context sizes).
- Added `workflow_dispatch` trigger to `ci.yml` for manual re-runs without an empty commit.

### 2026-08-27
- Fixed a `ruff` B023 warning in `chunking.py`: `flush()` was defined inside the section loop and read `section.heading_path` from the enclosing scope via closure rather than as a parameter. Moved `flush()` outside the loop and pass `heading_path` explicitly on each call. No behavior change, `test_heading_path_tracks_nesting` still passes; this removes a latent bug risk if the closure pattern were ever misused in a future edit.
- Ran `ruff check . --fix` across the repo: auto-fixed 36 style issues (import sorting, `Union[...]` → `X | Y` syntax, unused imports, nested `with` merging) in `alembic/env.py`, all migration files, and `main.py`. No logic changes.

### 2026-08-26
- Fixed `documents.id` violating not-null on raw SQL inserts: the SQLAlchemy model only had a Python-side `default=uuid.uuid4`, invisible to any insert that bypasses the ORM. Added `server_default=gen_random_uuid()` via migration, so the database itself always has a fallback.
- Fixed `app_user` role having no password: the role-creation migration set `LOGIN` but never `PASSWORD`, so password auth for that role always failed. Added a follow-up migration to set it from `settings.app_db_password`.
- Fixed `docker-compose.yml`'s `app` service missing `APP_DATABASE_URL`: `app_user`'s connection string had no value to read, silently falling back to a broken default (`localhost`, placeholder password).
- Completed Day 1 Part 4: tenant-scoped DB sessions (`db.py`), `/documents` POST+GET endpoints, `main.py` now connects as `app_user` (least-privilege) instead of `fazle` (table owner).
- Finding, not a bug: `fazle` is a Postgres superuser (created by the official Postgres/pgvector image's bootstrap process) and silently bypasses RLS regardless of `FORCE ROW LEVEL SECURITY`. All RLS verification must connect as `app_user`, never `fazle`.
- RLS isolation verified two ways: through the real HTTP API (curl) and directly at the DB layer (psql as `app_user`). Proof screenshots in `/proof/`.

### 2026-08-22
- Fixed `uv sync` silently installing nothing: root `pyproject.toml` had `package = false` and empty `dependencies`, so a plain `uv sync` never pulled in workspace member dependencies. Now using `uv sync --all-packages` for full workspace installs.
- Fixed Docker build failure on `core` and other packages: hatchling couldn't auto-detect the `src/` layout used across all five packages. Added explicit `[tool.hatch.build.targets.wheel]` with the correct `packages` path to each package's `pyproject.toml`.
- Fixed Postgres container failing healthcheck on startup: the `pgvector/pgvector:0.8.6-pg18-trixie` image (Postgres 18+) expects the volume mounted at `/var/lib/postgresql`, not `/var/lib/postgresql/data`. Updated `docker-compose.yml` accordingly.
- Fixed `app` container stuck in a restart loop with `exec /app/.venv/bin/uvicorn: no such file or directory`: the Dockerfile's builder stage used `WORKDIR /build`, so uv wrote an absolute `/build/.venv/bin/python` shebang into every installed script. That path doesn't exist in the runtime stage after copying. Changed builder stage to `WORKDIR /app` so the venv is built at the same path it's copied to.
- All four fixes verified: `docker compose ps` shows `app`, `db`, and `redis` all Up (healthy).

### 2026-08-17
- Repo initialized. MIT license, README/SECURITY/.env.example placeholders added.