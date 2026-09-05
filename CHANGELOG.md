# Changelog

## [Unreleased]

## 2026-09-05
- Migrate deployment from Render to Hugging Face Spaces (Gradio SDK wrapper around FastAPI, `hf-space` branch)
- Fix: replace deprecated `logging.getLevelNamesMapping()` with explicit level mapping (Python 3.10 compatibility for HF Spaces)

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