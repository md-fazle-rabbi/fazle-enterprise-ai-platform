"""
Integration test for the ingest endpoint's idempotency guarantee. Needs a
live Postgres (docker compose up -d db) — the ingest/dedup logic itself
runs for real. Embeddings are mocked (see conftest.py) so this doesn't
need a real VOYAGE_API_KEY or make a real Voyage API call.

Uses app.router.lifespan_context to run the app's real startup/shutdown
(building the DB engine and session_factory), since httpx's ASGITransport
does not trigger FastAPI lifespan events on its own, only a real server
(uvicorn) does that automatically.
"""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from rag_engine.main import app

TENANT = str(uuid.uuid4())
HEADERS = {"X-Tenant-ID": TENANT}


@pytest.mark.asyncio
async def test_ingesting_same_content_twice_is_idempotent():
    payload = {
        "source_path": "/tmp/idempotency-test.md",
        "text": "# Test\n\nSame content, ingested twice, should dedupe.",
    }
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        first = await client.post("/ingest", json=payload, headers=HEADERS)
        second = await client.post("/ingest", json=payload, headers=HEADERS)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["deduplicated"] is False
    assert second.json()["deduplicated"] is True
    assert first.json()["document_id"] == second.json()["document_id"]
    assert first.json()["chunk_count"] == second.json()["chunk_count"]
