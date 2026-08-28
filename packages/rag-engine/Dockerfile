# Build context is the repo root, docker-compose.yml sets context: .

FROM python:3.13.15-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:0.9.7 /uv /uvx /bin/
WORKDIR /app

COPY pyproject.toml uv.lock ./
COPY packages/core/pyproject.toml packages/core/pyproject.toml
COPY packages/rag-engine/pyproject.toml packages/rag-engine/pyproject.toml
COPY packages/agent-mesh/pyproject.toml packages/agent-mesh/pyproject.toml
COPY packages/observability/pyproject.toml packages/observability/pyproject.toml
COPY packages/governance/pyproject.toml packages/governance/pyproject.toml
RUN uv sync --frozen --no-install-project --package rag-engine

COPY packages/core packages/core
COPY packages/rag-engine packages/rag-engine
RUN uv sync --frozen --package rag-engine

FROM python:3.13.15-slim-bookworm AS runtime
# Patch OS CVEs Debian has already fixed upstream — the base tag only
# rebuilds on release, not on every security update, so this is what
# actually closes most of what Trivy flags on a freshly pulled image.
# Then strip pip/setuptools/wheel: ensurepip puts them in every fresh
# base image's system site-packages, invisible to uv.lock, and they
# were the real source of the CVEs — not this project's dependencies.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && find /usr/local/lib/python3.13/site-packages -maxdepth 1 \
        \( -name 'pip*' -o -name 'setuptools*' -o -name 'wheel*' \) \
        -exec rm -rf {} +

RUN groupadd --gid 1000 appuser && useradd --uid 1000 --gid appuser --create-home appuser
WORKDIR /app
COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv
COPY --from=builder --chown=appuser:appuser /app/packages /app/packages
ENV PATH="/app/.venv/bin:$PATH"
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
CMD ["uvicorn", "rag_engine.main:app", "--host", "0.0.0.0", "--port", "8000"]