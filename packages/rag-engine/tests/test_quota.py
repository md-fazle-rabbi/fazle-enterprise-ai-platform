"""Needs docker compose up -d redis first. This is the test that actually
proves the race is closed, not just that the happy path works."""

import asyncio
import uuid

import pytest
from rag_engine.quota import check_and_consume
from redis.asyncio import Redis

pytestmark = pytest.mark.asyncio


async def test_concurrent_requests_never_exceed_limit():
    redis = Redis.from_url("redis://localhost:6379/0")
    tenant_id = str(uuid.uuid4())
    limit = 100

    # 20 concurrent requests each trying to consume 10, limit is 100:
    # exactly 10 should succeed, the rest should raise, never all 20
    results = await asyncio.gather(
        *[
            check_and_consume(redis, tenant_id, tokens_used=10, daily_limit=limit)
            for _ in range(20)
        ],
        return_exceptions=True,
    )
    succeeded = [r for r in results if not isinstance(r, Exception)]
    assert len(succeeded) == 10
