"""
Thin wrapper around Voyage AI's embedding API. Anthropic doesn't offer its
own embedding model and names Voyage AI as its recommended partner for
Claude-based apps, that's the reason for this choice, not unfamiliarity
with alternatives.

Voyage's free tier (no payment method on the account) allows 3 requests per
minute, so this module spaces its own calls with a sliding-window limiter
instead of finding the limit by hitting a 429. It still retries a real 429 or a
transient network error, since the same API key can be used by other processes.

Two policies, because the two callers wait differently. Ingestion is a batch
job nobody is watching, so it waits for a free slot and retries patiently. A
question is asked by someone watching a screen, so it gives up quickly: a
call that cannot start within a few seconds, or hangs, fails inside about 40
seconds (the cache_lookup deadline in routers/query.py) instead of leaving the
stream silent.
"""

import asyncio
import time
from collections import deque
from dataclasses import dataclass

import aiohttp
import structlog
import voyageai
from core.settings import settings

EMBEDDING_MODEL = "voyage-4-large"
EMBEDDING_DIMENSION = 1024

# Why: the free tier's limit. A little over 60 s so clock skew between this process and
# Voyage's counter cannot put a fourth call inside the same window.
_REQUESTS_PER_WINDOW = 3
_WINDOW_SECONDS = 62.0

logger = structlog.get_logger()

_client = voyageai.AsyncClient(api_key=settings.voyage_api_key)  # type: ignore[attr-defined]


class EmbeddingRateLimited(Exception):
    """No Voyage request slot is free soon enough for the caller to wait for it."""


class _SlidingWindowLimiter:
    """
    Allows `max_calls` request starts per `window_seconds`, per process. Each caller
    reserves its start time without awaiting in between, so concurrent callers queue
    one after another without a lock. A lock would be bound to the first event loop
    that used it, which breaks anything that runs more than one loop (see
    core/llm_client.py).
    """

    def __init__(self, max_calls: int, window_seconds: float) -> None:
        self._window_seconds = window_seconds
        self._starts: deque[float] = deque(maxlen=max_calls)

    async def acquire(self, max_wait_seconds: float | None) -> None:
        now = time.monotonic()
        start = now
        if len(self._starts) == self._starts.maxlen:
            start = max(now, self._starts[0] + self._window_seconds)
        wait = start - now
        if max_wait_seconds is not None and wait > max_wait_seconds:
            raise EmbeddingRateLimited(f"next Voyage request slot is {wait:.0f} s away")
        self._starts.append(start)
        if wait > 0:
            await asyncio.sleep(wait)


_limiter = _SlidingWindowLimiter(_REQUESTS_PER_WINDOW, _WINDOW_SECONDS)


@dataclass(frozen=True)
class _RetryPolicy:
    # Why: how long to wait for a free request slot. None waits as long as it takes.
    max_limiter_wait_seconds: float | None
    # Why: a deadline per call, so one hung request cannot stall the whole pipeline.
    call_timeout_seconds: float
    rate_limit_backoff_seconds: float
    transient_backoff_seconds: float
    max_rate_limit_retries: int
    max_transient_retries: int


# Why: a batch job, nobody is watching. Waits for slots and keeps the patient retries
# it had before the limiter existed.
_INGESTION_POLICY = _RetryPolicy(
    max_limiter_wait_seconds=None,
    call_timeout_seconds=60,
    rate_limit_backoff_seconds=25,
    transient_backoff_seconds=5,
    max_rate_limit_retries=3,
    max_transient_retries=3,
)

# Why: worst case is 8 + 10 + 3 + 8 + 10 = 39 s, which fits the 40 s cache_lookup
# deadline in routers/query.py. A real 429 is not retried: this process already spaces
# its own calls, so a 429 means the quota is being used elsewhere and will not clear
# within a few seconds.
_QUERY_POLICY = _RetryPolicy(
    max_limiter_wait_seconds=8,
    call_timeout_seconds=10,
    rate_limit_backoff_seconds=0,
    transient_backoff_seconds=3,
    max_rate_limit_retries=0,
    max_transient_retries=1,
)


async def _embed_with_backoff(
    texts: list[str], input_type: str, policy: _RetryPolicy
) -> list[list[float]]:
    rate_limit_retries = 0
    transient_retries = 0
    while True:
        await _limiter.acquire(policy.max_limiter_wait_seconds)
        try:
            async with asyncio.timeout(policy.call_timeout_seconds):
                result = await _client.embed(
                    texts,
                    model=EMBEDDING_MODEL,
                    input_type=input_type,
                    output_dimension=EMBEDDING_DIMENSION,
                )
            return [[float(x) for x in vector] for vector in result.embeddings]
        except voyageai.error.RateLimitError:
            if rate_limit_retries >= policy.max_rate_limit_retries:
                raise
            rate_limit_retries += 1
            logger.warning(
                "voyage.rate_limited",
                attempt=rate_limit_retries,
                max_retries=policy.max_rate_limit_retries,
                backoff_seconds=policy.rate_limit_backoff_seconds,
            )
            await asyncio.sleep(policy.rate_limit_backoff_seconds)
        except (voyageai.error.APIConnectionError, aiohttp.ClientError, TimeoutError):
            if transient_retries >= policy.max_transient_retries:
                raise
            transient_retries += 1
            logger.warning(
                "voyage.transient_network_error",
                attempt=transient_retries,
                max_retries=policy.max_transient_retries,
                backoff_seconds=policy.transient_backoff_seconds,
            )
            await asyncio.sleep(policy.transient_backoff_seconds)


async def embed_documents(texts: list[str]) -> list[list[float]]:
    """Document-side embeddings, called once per chunk at ingestion time."""
    return await _embed_with_backoff(texts, "document", _INGESTION_POLICY)


async def embed_query(text: str) -> list[float]:
    """Query-side embedding, used at retrieval time, next phase."""
    vectors = await _embed_with_backoff([text], "query", _QUERY_POLICY)
    return vectors[0]
