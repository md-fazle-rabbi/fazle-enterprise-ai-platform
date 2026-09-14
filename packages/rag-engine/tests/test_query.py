"""
Does the answer actually cite a real retrieved chunk, not just sound
plausible. Needs a running Postgres. Embeddings and generation are mocked
(see conftest.py), so this doesn't need real VOYAGE_API_KEY/GEMINI_API_KEY
— the retrieval and citation-building logic still runs for real against
whatever was actually ingested.

Uses app.router.lifespan_context to run the app's real startup/shutdown
(building the DB engine and session_factory), since httpx's ASGITransport
does not trigger FastAPI lifespan events on its own.
"""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from rag_engine.main import app

TENANT = str(uuid.uuid4())
HEADERS = {"X-Tenant-ID": TENANT}


@pytest.mark.asyncio
async def test_query_answer_cites_a_real_retrieved_chunk():
    async with (
        app.router.lifespan_context(app),
        AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client,
    ):
        await client.post(
            "/ingest",
            json={
                "source_path": "/tmp/rls-note.md",
                "text": "# RLS\n\nPostgres Row-Level Security isolates tenants at the database layer, not the application layer.",
            },
            headers=HEADERS,
        )
        response = await client.post(
            "/query",
            json={"question": "How does this system isolate tenants?"},
            headers=HEADERS,
        )
    body = response.json()
    assert response.status_code == 200
    assert len(body["citations"]) > 0
    cited_text = body["citations"][0]["text"].lower()
    assert "database" in cited_text or "row-level" in cited_text
