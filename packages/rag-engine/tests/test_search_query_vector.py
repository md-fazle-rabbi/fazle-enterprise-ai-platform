import uuid
from typing import Any

import pytest
from rag_engine import search


@pytest.fixture
def stubbed_searches(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    calls: dict[str, Any] = {"embed": 0, "dense_vector": None}
    chunk_id = uuid.uuid4()

    async def fake_embed(_text: str) -> list[float]:
        calls["embed"] += 1
        return [0.1, 0.2]

    async def fake_dense(_session: Any, vector: list[float], _limit: int):
        calls["dense_vector"] = vector
        return [(chunk_id, 1)]

    async def fake_sparse(_session: Any, _text: str, _limit: int):
        return [(chunk_id, 1)]

    monkeypatch.setattr(search, "embed_query", fake_embed)
    monkeypatch.setattr(search, "_dense_search", fake_dense)
    monkeypatch.setattr(search, "_sparse_search", fake_sparse)
    return calls


@pytest.mark.asyncio
async def test_given_vector_is_used_and_nothing_is_embedded(
    stubbed_searches: dict[str, Any],
) -> None:
    await search.hybrid_search(None, "refund?", query_vector=[9.0, 9.0])  # type: ignore[arg-type]
    assert stubbed_searches["embed"] == 0
    assert stubbed_searches["dense_vector"] == [9.0, 9.0]


@pytest.mark.asyncio
async def test_without_a_vector_the_query_is_embedded_once(
    stubbed_searches: dict[str, Any],
) -> None:
    await search.hybrid_search(None, "refund?")  # type: ignore[arg-type]
    assert stubbed_searches["embed"] == 1
    assert stubbed_searches["dense_vector"] == [0.1, 0.2]
