import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from rag_engine.parent_retrieval import expand_to_parents


def _chunk(document_id: uuid.UUID, heading: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        document_id=document_id,
        heading_path=[heading],
        text=f"{heading} text",
        chunk_index=0,
    )


class _Rows:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class _FakeSession:
    """
    The first scalars() call is the matched-chunk fetch and returns the rows in
    the order the database chose. Every later call is a sibling lookup and gets
    one placeholder row, since only the order of the result is under test.
    """

    def __init__(self, database_order: list[Any]) -> None:
        self._database_order = database_order
        self._calls = 0

    async def scalars(self, _statement: Any) -> _Rows:
        self._calls += 1
        if self._calls == 1:
            return _Rows(self._database_order)
        return _Rows([SimpleNamespace(text="section text")])


@pytest.mark.asyncio
async def test_parents_follow_the_ranking_not_the_database_order():
    rls = _chunk(uuid.uuid4(), "RLS")
    chunking = _chunk(uuid.uuid4(), "Chunking")
    hybrid = _chunk(uuid.uuid4(), "Hybrid")
    session = _FakeSession([rls, chunking, hybrid])

    parents = await expand_to_parents(session, [hybrid.id, chunking.id, rls.id])

    assert [p["chunk_id"] for p in parents] == [hybrid.id, chunking.id, rls.id]


@pytest.mark.asyncio
async def test_shared_section_is_anchored_on_the_best_ranked_chunk():
    document_id = uuid.uuid4()
    first = _chunk(document_id, "Same section")
    second = _chunk(document_id, "Same section")
    session = _FakeSession([first, second])

    parents = await expand_to_parents(session, [second.id, first.id])

    assert len(parents) == 1
    assert parents[0]["chunk_id"] == second.id


@pytest.mark.asyncio
async def test_no_matching_chunks_returns_empty():
    session = _FakeSession([])

    assert await expand_to_parents(session, [uuid.uuid4()]) == []
