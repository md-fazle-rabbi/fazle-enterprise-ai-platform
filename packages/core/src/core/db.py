"""
Shared async SQLAlchemy engine and session factory. Every package that
touches Postgres imports from here, one connection pool, one Base metadata,
not one per package.
"""

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def make_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(database_url, pool_pre_ping=True)
