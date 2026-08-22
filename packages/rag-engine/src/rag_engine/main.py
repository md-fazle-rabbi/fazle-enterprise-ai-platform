"""
Entry point for the rag-engine service.
Why lifespan instead of @app.on_event("startup"/"shutdown"): the old
event-handler API is deprecated, and lifespan lets startup and shutdown share
state (a DB pool, a Redis client) through one generator instead of two
disconnected functions guessing at each other's globals.
"""
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from fastapi import FastAPI

from core import settings
from core.logging import configure_logging

configure_logging(settings.log_level)
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("rag_engine.startup", environment=settings.environment)
    # Next micro-step: open the asyncpg pool and Redis client here, store on
    # app.state, close them in the block after yield.
    yield
    logger.info("rag_engine.shutdown")


app = FastAPI(
    title="fazle-enterprise-ai-platform: rag-engine",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness: is the process running at all. No dependency checks."""
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> dict[str, str]:
    """
    Readiness: can this instance actually serve traffic.
    Placeholder today, always returns ok. Becomes a real DB/Redis ping in the
    next micro-step. This is a stated gap, tracked in README's Known
    Limitations, not a hidden one.
    """
    return {"status": "ok"}