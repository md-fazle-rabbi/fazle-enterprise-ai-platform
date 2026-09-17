"""
FastAPI entrypoint for rag-engine: wires up logging, tracing, DB/Redis
lifespan, routers, and health/readiness endpoints for the service.
"""

import signal
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from types import FrameType

import structlog
from core import settings
from core.db import make_engine
from fastapi import FastAPI, HTTPException, Request
from observability.logging import configure_logging
from observability.tracing import configure_tracing, instrument_app
from redis.asyncio import Redis as AsyncRedis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from rag_engine.routers import ingest_image, ingest_pdf
from rag_engine.routers.agents import admin_router
from rag_engine.routers.agents import router as agents_router
from rag_engine.routers.audit import router as audit_router
from rag_engine.routers.documents import router as documents_router
from rag_engine.routers.ingest import router as ingest_router
from rag_engine.routers.query import router as query_router
from rag_engine.routers.search import router as search_router
from rag_engine.security.classifier import _get_pipeline
from rag_engine.security.middleware import InjectionFirewallMiddleware

configure_logging(settings.log_level)
logger = structlog.get_logger()


def _log_signal(signum: int, frame: FrameType | None) -> None:
    logger.warning("rag_engine.signal_received", signal=signal.Signals(signum).name)


try:
    signal.signal(signal.SIGTERM, _log_signal)
    signal.signal(signal.SIGINT, _log_signal)
except ValueError:
    logger.warning("rag_engine.signal_handler_not_main_thread")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    # Connects as app_user, the least-privilege role, not the fazle owner
    # role — deliberate change from the original roadmap text.
    engine = make_engine(settings.app_database_url)
    app.state.engine = engine
    app.state.session_factory = async_sessionmaker(engine, expire_on_commit=False)
    app.state.redis = AsyncRedis.from_url(settings.redis_url)

    # Force the injection-detection model to load now, during startup,
    # instead of lazily on the first /query or /ingest request. Without
    # this, the first real request after every container start pays the
    # full model-load cost (and, without a persistent HF cache volume,
    # a full re-download) synchronously inside the request path — a
    # silent multi-second-to-multi-minute hang with no user-facing signal
    # that anything is happening.
    logger.info("rag_engine.loading_injection_classifier")
    _get_pipeline()
    logger.info("rag_engine.injection_classifier_ready")

    logger.info("rag_engine.startup", environment=settings.environment)
    yield
    await app.state.redis.aclose()
    await engine.dispose()
    logger.info("rag_engine.shutdown")


configure_tracing(service_name="rag-engine")

app = FastAPI(
    title="fazle-enterprise-ai-platform: rag-engine",
    version="0.1.0",
    lifespan=lifespan,
)
instrument_app(app)
app.include_router(documents_router)
app.include_router(ingest_router)
app.include_router(search_router)
app.include_router(query_router)
app.add_middleware(InjectionFirewallMiddleware)
app.include_router(ingest_image.router)
app.include_router(ingest_pdf.router)
app.include_router(agents_router)
app.include_router(admin_router)
app.include_router(audit_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"status": "ok", "service": "fazle-enterprise-ai-platform: rag-engine"}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
async def ready(request: Request) -> dict[str, str]:
    try:
        async with request.app.state.session_factory() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception:
        logger.warning("rag_engine.ready_check_failed", exc_info=True)
        raise HTTPException(status_code=503, detail="database unreachable")
