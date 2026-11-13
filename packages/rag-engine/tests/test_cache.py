import asyncio
import json
from typing import Any, cast

from rag_engine.cache import (
    CACHE_MAX_ENTRIES,
    cosine_similarity,
    get_cached_response,
    invalidate_tenant_cache,
    store_cached_response,
)
from redis.asyncio import Redis

TENANT = "00000000-0000-0000-0000-000000000001"
OTHER_TENANT = "00000000-0000-0000-0000-000000000002"
VECTOR = [1.0, 0.0, 0.0]
RESPONSE: dict[str, Any] = {
    "answer": "Refunds are available within 30 days [1].",
    "citations": [{"text": "Refund policy"}],
    "retrieved_context": [{"text": "Refund policy"}],
}


class FakeRedis:
    """Just the list commands the cache uses, kept in memory."""

    def __init__(self) -> None:
        self.lists: dict[str, list[str]] = {}

    async def lpush(self, key: str, value: str) -> None:
        self.lists.setdefault(key, []).insert(0, value)

    async def ltrim(self, key: str, start: int, stop: int) -> None:
        self.lists[key] = self.lists.get(key, [])[start : stop + 1]

    async def expire(self, key: str, seconds: int) -> bool:
        return True

    async def lrange(self, key: str, start: int, stop: int) -> list[str]:
        return self.lists.get(key, [])[start : stop + 1]

    async def delete(self, key: str) -> int:
        return 1 if self.lists.pop(key, None) is not None else 0


def as_redis(fake: FakeRedis) -> Redis:
    return cast("Redis", fake)


def test_identical_vectors_similarity_is_one():
    v = [1.0, 2.0, 3.0]
    assert cosine_similarity(v, v) == 1.0


def test_orthogonal_vectors_similarity_is_zero():
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0


def test_zero_vector_does_not_divide_by_zero():
    assert cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0


def test_hit_returns_the_stored_response_with_its_sources():
    fake = FakeRedis()
    asyncio.run(store_cached_response(as_redis(fake), TENANT, VECTOR, RESPONSE))
    cached = asyncio.run(get_cached_response(as_redis(fake), TENANT, VECTOR))
    assert cached == RESPONSE


def test_dissimilar_question_is_a_miss():
    fake = FakeRedis()
    asyncio.run(store_cached_response(as_redis(fake), TENANT, VECTOR, RESPONSE))
    cached = asyncio.run(get_cached_response(as_redis(fake), TENANT, [0.0, 1.0, 0.0]))
    assert cached is None


def test_entry_without_a_stored_response_is_a_miss():
    fake = FakeRedis()
    legacy = json.dumps({"embedding": VECTOR, "answer": "Refunds take 30 days [1, 2]."})
    fake.lists[f"semantic_cache:{TENANT}"] = [legacy]
    cached = asyncio.run(get_cached_response(as_redis(fake), TENANT, VECTOR))
    assert cached is None


def test_other_tenant_does_not_see_the_entry():
    fake = FakeRedis()
    asyncio.run(store_cached_response(as_redis(fake), TENANT, VECTOR, RESPONSE))
    cached = asyncio.run(get_cached_response(as_redis(fake), OTHER_TENANT, VECTOR))
    assert cached is None


def test_invalidate_drops_only_that_tenants_entries():
    fake = FakeRedis()
    asyncio.run(store_cached_response(as_redis(fake), TENANT, VECTOR, RESPONSE))
    asyncio.run(store_cached_response(as_redis(fake), OTHER_TENANT, VECTOR, RESPONSE))
    asyncio.run(invalidate_tenant_cache(as_redis(fake), TENANT))
    assert asyncio.run(get_cached_response(as_redis(fake), TENANT, VECTOR)) is None
    assert (
        asyncio.run(get_cached_response(as_redis(fake), OTHER_TENANT, VECTOR))
        == RESPONSE
    )


def test_store_keeps_only_the_newest_entries():
    fake = FakeRedis()
    for _ in range(CACHE_MAX_ENTRIES + 5):
        asyncio.run(store_cached_response(as_redis(fake), TENANT, VECTOR, RESPONSE))
    assert len(fake.lists[f"semantic_cache:{TENANT}"]) == CACHE_MAX_ENTRIES
