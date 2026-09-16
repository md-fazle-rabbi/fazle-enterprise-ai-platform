# Build context is the repo root, docker-compose.yml sets context: .

FROM python:3.13.15-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:0.9.7 /uv /uvx /bin/
WORKDIR /app

# uv's default 30s per-request timeout gets blown past once large
# packages (torch, spacy, pyarrow, scipy) saturate the connection;
# bump it so a slow chunk mid-download doesn't kill the whole sync.
ENV UV_HTTP_TIMEOUT=300

COPY pyproject.toml uv.lock ./
COPY packages/core/pyproject.toml packages/core/pyproject.toml
COPY packages/rag-engine/pyproject.toml packages/rag-engine/pyproject.toml
COPY packages/agent-mesh/pyproject.toml packages/agent-mesh/pyproject.toml
COPY packages/observability/pyproject.toml packages/observability/pyproject.toml
COPY packages/governance/pyproject.toml packages/governance/pyproject.toml

# Cache mount: uv's package cache persists across builds even when this
# layer is invalidated by later source changes, so editing classifier.py
# etc. no longer forces a full re-download of torch/transformers/spacy
# from PyPI. This is what actually stops the build-cache bloat problem
# at the source, rather than pruning after the fact.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --package rag-engine

# Moved ahead of the source COPY below on purpose: this depends only on
# spacy being installed (already true after the deps-only sync above),
# never on this project's own source. Downloading it here means editing
# query.py/generation.py/etc. no longer invalidates this layer and
# re-triggers a full network fetch of the model on every source change.
# Note this download goes through spacy's own downloader, not uv, so the
# uv cache mount doesn't cover it, keeping this layer cache-stable is
# what actually avoids the repeat network hit, not the cache mount.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv run python -m spacy download en_core_web_sm

COPY packages/core packages/core
COPY packages/rag-engine packages/rag-engine
COPY packages/agent-mesh packages/agent-mesh

# --inexact matters here: uv sync's default is to make the environment
# match uv.lock exactly, which means removing anything it doesn't
# recognize. The spacy model above was installed via spaCy's own
# downloader, not uv, so it isn't tracked in uv.lock, a plain `uv sync`
# here would silently delete it right after it was installed, that
# happened, this flag is the fix for it, not a stylistic choice.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --package rag-engine --inexact

FROM python:3.13.15-slim-bookworm AS runtime
# Patch OS CVEs Debian has already fixed upstream, the base tag only
# rebuilds on release, not on every security update, so this is what
# actually closes most of what Trivy flags on a freshly pulled image.
# tesseract-ocr installs here too, in the same apt transaction, on
# purpose: this whole RUN sits before COPY --from=builder below, so it
# stays cache-stable across source edits instead of re-running
# apt-get update/install over the network every time application code
# changes, which is what happened when this install lived after the
# COPY --from=builder steps.
# Then strip pip/setuptools/wheel: ensurepip puts them in every fresh
# base image's system site-packages, invisible to uv.lock, and they
# were the real source of the CVEs, not this project's dependencies.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && find /usr/local/lib/python3.13/site-packages -maxdepth 1 \
        \( -name 'pip*' -o -name 'setuptools*' -o -name 'wheel*' \) \
        -exec rm -rf {} +

RUN groupadd --gid 1000 appuser && useradd --uid 1000 --gid appuser --create-home appuser
WORKDIR /app
COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv
COPY --from=builder --chown=appuser:appuser /app/packages /app/packages
ENV PATH="/app/.venv/bin:$PATH"

# Pre-create the HF cache dir owned by appuser. The docker-compose
# "hf-cache" named volume mounts here; without this, Docker creates the
# mount point as root on first use (since the path doesn't exist in the
# image yet), and appuser then can't write to it when transformers tries
# to download/cache model weights at runtime.
RUN mkdir -p /home/appuser/.cache/huggingface && chown -R appuser:appuser /home/appuser/.cache

USER appuser
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://localhost:' + os.environ.get('PORT','8000') + '/health')" || exit 1
CMD ["sh", "-c", "exec uvicorn rag_engine.main:app --host 0.0.0.0 --port ${PORT:-8000}"]