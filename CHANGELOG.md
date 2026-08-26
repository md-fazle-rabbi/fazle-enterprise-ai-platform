# Changelog

## [Unreleased]

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