"""
Shared async SQLAlchemy engine and session factory. Every package that
touches Postgres imports from here, one connection pool, one Base metadata,
not one per package.
"""

import ssl

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def make_engine(database_url: str) -> AsyncEngine:
    # Supabase's connection pooler (Supavisor) presents a self-signed
    # certificate, so full chain verification fails even against the
    # correct host. This matches sslmode=require semantics (encrypt the
    # connection, don't verify the certificate chain) rather than
    # sslmode=verify-full, which is what Supabase itself documents for
    # pooler connections.
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    return create_async_engine(
        database_url,
        pool_pre_ping=True,
        connect_args={"ssl": ssl_context},
    )
