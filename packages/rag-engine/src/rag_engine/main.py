from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import structlog
from core import settings
from core.db import make_engine
from core.logging import configure_logging
from fastapi import FastAPI, HTTPException, Request
from redis.asyncio import Redis as AsyncRedis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from rag_engine.routers import ingest_image, ingest_pdf
from rag_engine.routers.documents import router as documents_router
from rag_engine.routers.ingest import router as ingest_router
from rag_engine.routers.query import router as query_router
from rag_engine.routers.search import router as search_router
from rag_engine.security.middleware import InjectionFirewallMiddleware

configure_logging(settings.log_level)
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    # Connects as app_user, the least-privilege role, not the fazle owner
    # role — deliberate change from the original roadmap text.
    engine = make_engine(settings.app_database_url)
    app.state.engine = engine
    app.state.session_factory = async_sessionmaker(engine, expire_on_commit=False)
    app.state.redis = AsyncRedis.from_url(settings.redis_url)
    logger.info("rag_engine.startup", environment=settings.environment)
    yield
    await app.state.redis.aclose()
    await engine.dispose()
    logger.info("rag_engine.shutdown")


app = FastAPI(
    title="fazle-enterprise-ai-platform: rag-engine",
    version="0.1.0",
    lifespan=lifespan,
)
app.include_router(documents_router)
app.include_router(ingest_router)
app.include_router(search_router)
app.include_router(query_router)
app.add_middleware(InjectionFirewallMiddleware)
app.include_router(ingest_image.router)
app.include_router(ingest_pdf.router)


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
