"""
Shared async SQLAlchemy engine and session factory. Every package that
touches Postgres imports from here, one connection pool, one Base metadata,
not one per package.
"""

import ssl

import certifi
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def make_engine(database_url: str) -> AsyncEngine:
    # Passing ?ssl=require in the URL query string is not reliably parsed by
    # SQLAlchemy's asyncpg dialect and can silently fall back to no SSL,
    # which breaks Supabase's pooler (SNI-based tenant identification
    # requires a real TLS handshake). An explicit ssl.SSLContext via
    # connect_args is passed straight to asyncpg, unambiguous.
    # certifi's CA bundle is used explicitly rather than the platform's
    # default trust store, which can be stale or, on some networks,
    # intercepted by a middlebox the platform store doesn't recognize.
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    return create_async_engine(
        database_url,
        pool_pre_ping=True,
        connect_args={"ssl": ssl_context},
    )
