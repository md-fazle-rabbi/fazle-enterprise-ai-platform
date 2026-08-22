# Build context is the repo root, docker-compose.yml sets context: .

FROM python:3.13.15-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
# pin this to your own `uv --version` from Day 0 once you've checked it,
# :latest works for now but drifts over time
WORKDIR /app

# All workspace pyproject.toml files first. uv needs to see the whole
# workspace shape to trust uv.lock, even though only rag-engine gets synced.
# This layer only invalidates when a dependency changes, not on every commit.
COPY pyproject.toml uv.lock ./
COPY packages/core/pyproject.toml packages/core/pyproject.toml
COPY packages/rag-engine/pyproject.toml packages/rag-engine/pyproject.toml
COPY packages/agent-mesh/pyproject.toml packages/agent-mesh/pyproject.toml
COPY packages/observability/pyproject.toml packages/observability/pyproject.toml
COPY packages/governance/pyproject.toml packages/governance/pyproject.toml
RUN uv sync --frozen --no-install-project --package rag-engine

# Now the actual source, this layer invalidates on every code change
COPY packages/core packages/core
COPY packages/rag-engine packages/rag-engine
RUN uv sync --frozen --package rag-engine

FROM python:3.13.15-slim AS runtime
RUN groupadd --gid 1000 appuser && useradd --uid 1000 --gid appuser --create-home appuser
WORKDIR /app
COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv
COPY --from=builder --chown=appuser:appuser /app/packages /app/packages
ENV PATH="/app/.venv/bin:$PATH"
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
CMD ["uvicorn", "rag_engine.main:app", "--host", "0.0.0.0", "--port", "8000"]