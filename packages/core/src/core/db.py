"""
Shared async SQLAlchemy engine and session factory. Every package that
touches Postgres imports from here, one connection pool, one Base metadata,
not one per package.
"""

import ssl
from urllib.parse import urlparse

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def make_engine(database_url: str) -> AsyncEngine:
    connect_args: dict[str, object] = {}

    host = urlparse(database_url).hostname or ""
    if host not in ("localhost", "127.0.0.1"):
        # Supabase's pooler (Supavisor) presents a certificate that
        # doesn't chain to a CA in the standard trust store. This is the
        # documented workaround for Python clients: encrypt without
        # verifying the chain. CI's local Postgres test container has no
        # SSL configured at all, so this is skipped for localhost or the
        # SSLRequest handshake gets rejected outright.
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
