# Changelog

## [Unreleased]

### 2026-08-22
- Fixed `uv sync` silently installing nothing: root `pyproject.toml` had `package = false` and empty `dependencies`, so a plain `uv sync` never pulled in workspace member dependencies. Now using `uv sync --all-packages` for full workspace installs.
- Fixed Docker build failure on `core` and other packages: hatchling couldn't auto-detect the `src/` layout used across all five packages. Added explicit `[tool.hatch.build.targets.wheel]` with the correct `packages` path to each package's `pyproject.toml`.
- Fixed Postgres container failing healthcheck on startup: the `pgvector/pgvector:0.8.6-pg18-trixie` image (Postgres 18+) expects the volume mounted at `/var/lib/postgresql`, not `/var/lib/postgresql/data`. Updated `docker-compose.yml` accordingly.
- Fixed `app` container stuck in a restart loop with `exec /app/.venv/bin/uvicorn: no such file or directory`: the Dockerfile's builder stage used `WORKDIR /build`, so uv wrote an absolute `/build/.venv/bin/python` shebang into every installed script. That path doesn't exist in the runtime stage after copying. Changed builder stage to `WORKDIR /app` so the venv is built at the same path it's copied to.
- All four fixes verified: `docker compose ps` shows `app`, `db`, and `redis` all Up (healthy).

### 2026-08-17
- Repo initialized. MIT license, README/SECURITY/.env.example placeholders added.