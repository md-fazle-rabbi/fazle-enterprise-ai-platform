import time

import pytest
from rag_engine.embeddings import EmbeddingRateLimited, _SlidingWindowLimiter
from rag_engine.main import _embedding_rate_limited
from starlette.requests import Request

pytestmark = pytest.mark.asyncio


async def test_a_call_over_the_limit_fails_fast_when_it_may_not_wait() -> None:
    limiter = _SlidingWindowLimiter(max_calls=3, window_seconds=60)
    for _ in range(3):
        await limiter.acquire(0)
    with pytest.raises(EmbeddingRateLimited):
        await limiter.acquire(0)


async def test_a_call_over_the_limit_waits_for_the_window_when_it_may() -> None:
    limiter = _SlidingWindowLimiter(max_calls=2, window_seconds=0.3)
    started = time.monotonic()
    for _ in range(3):
        await limiter.acquire(None)
    assert time.monotonic() - started >= 0.25


async def test_the_limiter_error_says_how_long_to_wait() -> None:
    limiter = _SlidingWindowLimiter(max_calls=1, window_seconds=30)
    await limiter.acquire(0)
    with pytest.raises(EmbeddingRateLimited) as info:
        await limiter.acquire(0)
    assert 29 <= info.value.retry_after_seconds <= 30


async def test_a_busy_slot_becomes_a_503_with_retry_after() -> None:
    request = Request(
        {"type": "http", "method": "POST", "path": "/query", "headers": []}
    )
    response = await _embedding_rate_limited(request, EmbeddingRateLimited(59.2))
    assert response.status_code == 503
    assert response.headers["retry-after"] == "60"
    assert b"60 seconds" in bytes(response.body)
