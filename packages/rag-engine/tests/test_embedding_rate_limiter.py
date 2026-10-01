import time

import pytest
from rag_engine.embeddings import EmbeddingRateLimited, _SlidingWindowLimiter

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
