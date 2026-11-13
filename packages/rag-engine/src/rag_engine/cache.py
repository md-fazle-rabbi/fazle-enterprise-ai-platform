"""
Semantic cache: skips a full Gemini call when a new question is highly
similar (cosine >=0.95) to one already answered for this tenant recently.
Caches (question_embedding, checked response) pairs so paraphrases hit the
cache, not just exact repeats. The whole response is kept, sources included,
so a hit reads exactly like the first answer and its [N] markers still
resolve. Entries live under one key per tenant, expire after an hour, and are
dropped when the tenant deletes a document. Bounded to the 50 most recent
entries per tenant, a Python-side O(n) cosine scan over 50 items is fine,
wouldn't scale to thousands without a real vector index for the cache itself,
stated as the scaling limit, not silently assumed away.
"""

import json
from typing import Any

from redis.asyncio import Redis

CACHE_SIMILARITY_THRESHOLD = 0.95
CACHE_TTL_SECONDS = 3600
CACHE_MAX_ENTRIES = 50


def _key(tenant_id: str) -> str:
    return f"semantic_cache:{tenant_id}"


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    return dot / (norm_a * norm_b) if norm_a and norm_b else 0.0


async def get_cached_response(
    redis: Redis, tenant_id: str, query_vector: list[float]
) -> dict[str, Any] | None:
    entries = await redis.lrange(_key(tenant_id), 0, CACHE_MAX_ENTRIES - 1)
    for raw in entries:
        entry = json.loads(raw)
        response = entry.get("response")
        # Why: an entry written before the cache held whole responses carries only
        # an "answer" and has no sources to show. It is a miss, so the question is
        # answered fresh instead of replaying an answer whose citations cannot open.
        if not isinstance(response, dict):
            continue
        if (
            cosine_similarity(query_vector, entry["embedding"])
            >= CACHE_SIMILARITY_THRESHOLD
        ):
            return response
    return None


async def store_cached_response(
    redis: Redis,
    tenant_id: str,
    query_vector: list[float],
    response: dict[str, Any],
) -> None:
    key = _key(tenant_id)
    await redis.lpush(
        key, json.dumps({"embedding": query_vector, "response": response})
    )
    await redis.ltrim(key, 0, CACHE_MAX_ENTRIES - 1)
    await redis.expire(key, CACHE_TTL_SECONDS)


async def invalidate_tenant_cache(redis: Redis, tenant_id: str) -> None:
    # Why: cached responses carry the text of the documents they were built from. When
    # a document is deleted, none of them may be served again, so the tenant's whole
    # cache goes. A cold cache costs a few model calls; a stale one keeps showing
    # content the tenant removed.
    await redis.delete(_key(tenant_id))
