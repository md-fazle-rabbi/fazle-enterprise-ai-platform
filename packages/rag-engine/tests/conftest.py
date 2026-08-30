"""
Shared test fixtures. Mocks Voyage (embeddings) and Gemini (generation)
so the test suite never needs real API keys or makes real network calls —
tests stay fast, deterministic, and runnable in CI without secrets.

Patched at point of use, not at definition: ingest.py, search.py, and
query.py each do `from rag_engine.embeddings import embed_documents` /
`embed_query` / `from rag_engine.generation import generate_answer`,
which binds a separate name in each importing module. Patching
rag_engine.embeddings.embed_documents would leave those already-bound
names untouched and still hitting the real API.
"""

import pytest


@pytest.fixture(autouse=True)
def mock_voyage_embeddings(monkeypatch):
    async def _fake_embed_documents(texts: list[str]) -> list[list[float]]:
        return [[0.01] * 1024 for _ in texts]

    async def _fake_embed_query(text: str) -> list[float]:
        return [0.01] * 1024

    monkeypatch.setattr(
        "rag_engine.routers.ingest.embed_documents", _fake_embed_documents
    )
    monkeypatch.setattr("rag_engine.search.embed_query", _fake_embed_query)


@pytest.fixture(autouse=True)
def mock_gemini_generation(monkeypatch):
    """Cites every chunk passed in with a [N] tag, so any test asserting
    on citations has something real to work with — citation *text* still
    comes from the actually-ingested/retrieved chunk, this only fakes
    the LLM call itself."""

    async def _fake_generate_answer(question: str, chunks: list[dict]) -> str:
        tags = " ".join(f"[{i + 1}]" for i in range(len(chunks)))
        return f"Mocked answer for: {question} {tags}".strip()

    monkeypatch.setattr(
        "rag_engine.routers.query.generate_answer", _fake_generate_answer
    )
