import os

import pytest

from rag_engine.embeddings import EMBEDDING_DIMENSION, embed_documents, embed_query

pytestmark = pytest.mark.skipif(
    not os.getenv("VOYAGE_API_KEY"),
    reason="requires a real VOYAGE_API_KEY, not run without one configured",
)


@pytest.mark.asyncio
async def test_embed_documents_returns_correct_dimension():
    vectors = await embed_documents(["hello world"])
    assert len(vectors) == 1
    assert len(vectors[0]) == EMBEDDING_DIMENSION


@pytest.mark.asyncio
async def test_embed_query_returns_correct_dimension():
    vector = await embed_query("hello world")
    assert len(vector) == EMBEDDING_DIMENSION
