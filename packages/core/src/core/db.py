"""
Shared async SQLAlchemy engine and session factory. Every package that
touches Postgres imports from here, one connection pool, one Base metadata,
not one per package.
"""

import ssl

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from core.settings import settings


class Base(DeclarativeBase):
    pass


def make_engine(database_url: str) -> AsyncEngine:
    connect_args: dict[str, object] = {}

    # SSL is gated on environment, not hostname. Local dev and the
    # docker-compose "db" service run Postgres with no SSL configured at
    # all, so attempting an SSLRequest handshake against them gets
    # rejected outright. Any non-local environment (staging, production)
    # is assumed to sit behind a pooler such as Supabase's Supavisor,
    # whose certificate doesn't chain to a CA in the standard trust
    # store, hence the documented CERT_NONE workaround below.
    if settings.environment != "development":
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        connect_args["ssl"] = ssl_context
        # Supavisor's transaction-mode pooler doesn't support asyncpg's
        # prepared-statement caching (each pooled backend connection can
        # differ request to request), so caching must be disabled or
        # you'll eventually hit DuplicatePreparedStatementError under
        # concurrent load. Not needed against a local, unpooled Postgres.
        connect_args["statement_cache_size"] = 0

    return create_async_engine(
        database_url,
        pool_pre_ping=True,
        connect_args=connect_args,
    )
