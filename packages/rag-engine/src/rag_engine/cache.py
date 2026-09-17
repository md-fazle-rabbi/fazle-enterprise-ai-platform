"""
Semantic cache: skips a full Gemini call when a new question is highly
similar (cosine >=0.95) to one already answered for this tenant recently.
Caches (question_embedding, answer) pairs so paraphrases hit the cache,
not just exact repeats. Bounded to the 50 most recent entries per tenant,
a Python-side O(n) cosine scan over 50 items is fine, wouldn't scale to
thousands without a real vector index for the cache itself, stated as
the scaling limit, not silently assumed away.
"""

import json

from redis.asyncio import Redis

CACHE_SIMILARITY_THRESHOLD = 0.95
CACHE_TTL_SECONDS = 3600
CACHE_MAX_ENTRIES = 50


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    return dot / (norm_a * norm_b) if norm_a and norm_b else 0.0


async def get_cached_answer(
    redis: Redis, tenant_id: str, query_vector: list[float]
) -> str | None:
    entries = await redis.lrange(
        f"semantic_cache:{tenant_id}", 0, CACHE_MAX_ENTRIES - 1
    )
    for raw in entries:
        entry = json.loads(raw)
        if (
            cosine_similarity(query_vector, entry["embedding"])
            >= CACHE_SIMILARITY_THRESHOLD
        ):
            return str(entry["answer"])
    return None


async def store_cached_answer(
    redis: Redis, tenant_id: str, query_vector: list[float], answer: str
) -> None:
    key = f"semantic_cache:{tenant_id}"
    await redis.lpush(key, json.dumps({"embedding": query_vector, "answer": answer}))
    await redis.ltrim(key, 0, CACHE_MAX_ENTRIES - 1)
    await redis.expire(key, CACHE_TTL_SECONDS)
