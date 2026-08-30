"""
Thin wrapper around Voyage AI's embedding API. Anthropic doesn't offer its
own embedding model and names Voyage AI as its recommended partner for
Claude-based apps, that's the reason for this choice, not unfamiliarity
with alternatives.

Retries on Voyage rate limits and transient network/DNS errors with
backoff, same approach as evals/run_ragas.py: a longer wait for rate
limits (which clear on Voyage's schedule, not ours), a shorter wait for
transient connection failures (which tend to clear within seconds).
"""

import asyncio

import aiohttp
import structlog
import voyageai
from core.settings import settings

EMBEDDING_MODEL = "voyage-4-large"
EMBEDDING_DIMENSION = 1024

_VOYAGE_RATE_LIMIT_BACKOFF_SECONDS = 25
_TRANSIENT_ERROR_BACKOFF_SECONDS = 5
_MAX_RETRIES = 3

logger = structlog.get_logger()

_client = voyageai.AsyncClient(api_key=settings.voyage_api_key)  # type: ignore[attr-defined]


async def _embed_with_backoff(texts: list[str], input_type: str) -> list[list[float]]:
    for attempt in range(_MAX_RETRIES + 1):
        try:
            result = await _client.embed(
                texts,
                model=EMBEDDING_MODEL,
                input_type=input_type,
                output_dimension=EMBEDDING_DIMENSION,
            )
            return [[float(x) for x in vector] for vector in result.embeddings]
        except voyageai.error.RateLimitError:
            if attempt == _MAX_RETRIES:
                raise
            logger.warning(
                "voyage.rate_limited",
                attempt=attempt + 1,
                max_retries=_MAX_RETRIES,
                backoff_seconds=_VOYAGE_RATE_LIMIT_BACKOFF_SECONDS,
            )
            await asyncio.sleep(_VOYAGE_RATE_LIMIT_BACKOFF_SECONDS)
        except (voyageai.error.APIConnectionError, aiohttp.ClientError):
            if attempt == _MAX_RETRIES:
                raise
            logger.warning(
                "voyage.transient_network_error",
                attempt=attempt + 1,
                max_retries=_MAX_RETRIES,
                backoff_seconds=_TRANSIENT_ERROR_BACKOFF_SECONDS,
            )
            await asyncio.sleep(_TRANSIENT_ERROR_BACKOFF_SECONDS)
    raise RuntimeError("unreachable")


async def embed_documents(texts: list[str]) -> list[list[float]]:
    """Document-side embeddings, called once per chunk at ingestion time."""
    return await _embed_with_backoff(texts, input_type="document")


async def embed_query(text: str) -> list[float]:
    """Query-side embedding, used at retrieval time, next phase."""
    vectors = await _embed_with_backoff([text], input_type="query")
    return vectors[0]
