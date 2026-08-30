"""
Shared test fixtures. Mocks Voyage (embeddings), Gemini (generation), the
CRAG relevance grader, and the injection-firewall classifier so the test
suite never needs real API keys, HuggingFace gated-model access, or makes
real network calls — tests stay fast, deterministic, and runnable in CI
without secrets.

Patched at point of use, not at definition: ingest.py, search.py, and
query.py each do `from rag_engine.embeddings import embed_documents` /
`embed_query` / `from rag_engine.generation import generate_answer` /
`from rag_engine.crag import grade_relevance`, which binds a separate
name in each importing module. Patching rag_engine.embeddings.embed_documents
would leave those already-bound names untouched and still hitting the
real API.
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
    async def _fake_generate_answer(question: str, chunks: list[dict]) -> str:
        tags = " ".join(f"[{i + 1}]" for i in range(len(chunks)))
        return f"Mocked answer for: {question} {tags}".strip()

    monkeypatch.setattr(
        "rag_engine.routers.query.generate_answer", _fake_generate_answer
    )


@pytest.fixture(autouse=True)
def mock_crag_grading(monkeypatch):
    """Isolated grade_relevance() logic (RELEVANT/IRRELEVANT parsing) is
    covered directly in test_crag.py against a mocked genai client. Here,
    at the /query endpoint level, we only need the gate to pass so
    retrieval and citation-building run for real — the grader's own
    correctness isn't this test's concern."""

    async def _fake_grade_relevance(question: str, parents: list[dict]) -> bool:
        return True

    monkeypatch.setattr(
        "rag_engine.routers.query.grade_relevance", _fake_grade_relevance
    )


@pytest.fixture(autouse=True)
def mock_injection_firewall(monkeypatch):
    """The real firewall loads a gated HuggingFace model
    (Llama-Prompt-Guard-2-86M) on first use, requiring HF_TOKEN and
    network access. Tests exercise ingest/query request handling, not
    the classifier's own accuracy — that's Prompt Guard's job to get
    right, not this test suite's. Faking a clean bill of health here
    keeps tests independent of HF availability and account state."""
    from rag_engine.security.firewall import InjectionAssessment

    def _fake_assess(text: str) -> InjectionAssessment:
        return InjectionAssessment(
            pattern_hit=False, classifier_score=0.0, action="allow"
        )

    monkeypatch.setattr("rag_engine.security.middleware.assess", _fake_assess)
