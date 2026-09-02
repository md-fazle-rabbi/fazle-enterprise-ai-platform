"""
Proves image ingestion redacts PII before embedding/storage — the wiring,
not vision-model accuracy (extract_image_content is mocked). Needs a
running Postgres (see conftest.py); embeddings and the firewall are
mocked, so no VOYAGE_API_KEY or HF_TOKEN is needed.
"""

import io
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from rag_engine.main import app
from sqlalchemy import select, text

TENANT = str(uuid.uuid4())
HEADERS = {"X-Tenant-ID": TENANT}


def _fake_png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), color="white").save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_image_ingestion_redacts_pii(monkeypatch):
    from rag_engine.models import Chunk
    from rag_engine.routers import ingest_image as mod

    async def _fake_extract(image_bytes: bytes) -> tuple[str, str]:
        return "Contact John Smith at john@example.com for details.", "image"

    monkeypatch.setattr(mod, "extract_image_content", _fake_extract)

    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        response = await client.post(
            "/ingest/image",
            headers=HEADERS,
            files={"file": ("test.png", _fake_png(), "image/png")},
        )
        assert response.status_code == 201

        session_factory = app.state.session_factory
        async with session_factory() as session:
            await session.execute(
                text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
                {"tenant_id": TENANT},
            )
            chunk = await session.scalar(
                select(Chunk).where(
                    Chunk.document_id == uuid.UUID(response.json()["document_id"])
                )
            )

    assert chunk is not None
    assert "John Smith" not in chunk.text
    assert "john@example.com" not in chunk.text
