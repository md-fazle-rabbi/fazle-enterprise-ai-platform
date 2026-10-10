"""
Stored text is held to a stricter line than a question. A score in the flag range
(0.60 up to 0.95) refuses an /ingest request, which keeps the text for every later
user, but still lets the same text through as a question. The classifier is faked
here, so only the policy is under test, not the model.
"""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from rag_engine.security import middleware
from rag_engine.security.firewall import (
    InjectionAssessment,
    assess,
    blocks_stored_content,
)
from rag_engine.security.middleware import InjectionFirewallMiddleware

# Why: measured on the live stack, an injection hidden in a long benign document.
FLAGGED_SCORE = 0.88
HARMLESS_TEXT = "A harmless sentence about quarterly revenue."


@pytest.fixture
def fake_score(monkeypatch):
    """Puts the real assess() back in the middleware (conftest fakes it) and lets a
    test choose the classifier's score."""
    scores = {"value": 0.0}

    async def _score(_: str) -> float:
        return scores["value"]

    monkeypatch.setattr("rag_engine.security.firewall.classifier_score", _score)
    monkeypatch.setattr(middleware, "assess", assess)
    return scores


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(InjectionFirewallMiddleware)

    @app.post("/ingest")
    async def ingest() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/query")
    async def query() -> dict[str, bool]:
        return {"ok": True}

    return app


@pytest.mark.parametrize(
    ("action", "refused"),
    [("allow", False), ("flag", True), ("block", True)],
)
def test_stored_content_is_refused_on_a_flag_or_a_block(action, refused):
    assessment = InjectionAssessment(
        pattern_hit=False, classifier_score=0.5, action=action
    )

    assert blocks_stored_content(assessment) is refused


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("score", "ingest_status", "query_status"),
    [
        (0.10, 200, 200),
        (FLAGGED_SCORE, 400, 200),
        (0.97, 400, 400),
    ],
)
async def test_ingest_is_stricter_than_query(
    fake_score, score, ingest_status, query_status
):
    fake_score["value"] = score
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://test"
    ) as client:
        ingest = await client.post(
            "/ingest", json={"source_path": "a.md", "text": HARMLESS_TEXT}
        )
        query = await client.post("/query", json={"question": HARMLESS_TEXT})

    assert ingest.status_code == ingest_status
    assert query.status_code == query_status
