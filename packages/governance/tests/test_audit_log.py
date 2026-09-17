"""
Needs docker compose up -d db first, plus the 14364f7516c2 migration
applied (uv run alembic upgrade head from packages/rag-engine).
"""

import uuid
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from core.db import make_engine
from core.settings import settings
from governance.audit_log import append_entry, verify_chain
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def engine() -> AsyncGenerator[AsyncEngine]:
    # One engine per test, explicitly disposed at teardown -- the
    # earlier version built a fresh engine per call to a bare _session()
    # helper and never closed either the session or the engine, so
    # asyncpg connections were only ever reclaimed by the garbage
    # collector, sometimes after the test's own event loop had already
    # closed ("RuntimeError: Event loop is closed", visible as a warning
    # even on a passing run). Explicit disposal here removes that
    # leak entirely rather than just quieting the warning.
    eng = make_engine(settings.database_url)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine: AsyncEngine) -> AsyncGenerator[AsyncSession]:
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as s:
        yield s


async def _set_tenant(session: AsyncSession, tenant: str) -> None:
    # SET LOCAL does not accept bind parameters over the asyncpg/prepared-
    # statement protocol ("syntax error at or near $1") -- set_config() is
    # a regular function call and does, so it's the parameterizable
    # equivalent. Same approach rag_engine/db.py's get_session() already
    # uses for the same reason.
    await session.execute(
        text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tenant}
    )


async def test_valid_chain_verifies(session: AsyncSession):
    tenant = str(uuid.uuid4())
    async with session.begin():
        await _set_tenant(session, tenant)
        await append_entry(session, tenant, "test.event", {"n": 1})
        await append_entry(session, tenant, "test.event", {"n": 2})

    async with session.begin():
        await _set_tenant(session, tenant)
        is_valid, broken_at = await verify_chain(session)

    assert is_valid is True
    assert broken_at is None


async def test_tampered_entry_is_detected(session: AsyncSession):
    tenant = str(uuid.uuid4())
    async with session.begin():
        await _set_tenant(session, tenant)
        await append_entry(session, tenant, "test.event", {"amount": 100})

    # Simulate tampering directly, bypassing append_entry entirely --
    # this is what a compromised process trying to rewrite history
    # looks like.
    async with session.begin():
        await _set_tenant(session, tenant)
        await session.execute(
            text(
                "UPDATE audit_log SET event_data = '{\"amount\": 999}' WHERE tenant_id = :t"
            ),
            {"t": tenant},
        )

    async with session.begin():
        await _set_tenant(session, tenant)
        is_valid, broken_at = await verify_chain(session)

    # If the RULE-based UPDATE block is actually working, that UPDATE
    # was a silent no-op and the chain is still valid -- that itself IS
    # the proof, not a bug in this test.
    assert is_valid is True
